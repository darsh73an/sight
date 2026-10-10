import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const ACCESS_TOKEN_KEY = 'errsight_access_token';
const REFRESH_TOKEN_KEY = 'errsight_refresh_token';

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function redirectToLogin(): void {
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: '/api',
});

// Attach the access token to every outgoing request automatically - no
// route needs to remember to do this itself.
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

// Access tokens are now short-lived (see src/config/index.ts's jwt.expiresIn
// comment) - a 401 no longer automatically means "log out", it usually
// just means "refresh and retry". Only a failed refresh actually signs
// the user out.
let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

function queueRequest(cb: (token: string) => void): void {
  pendingRequests.push(cb);
}

function resolveQueue(token: string): void {
  pendingRequests.forEach((cb) => cb(token));
  pendingRequests = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    const originalRequest = error.config as RetriableConfig | undefined;
    if (!originalRequest || originalRequest._retry) {
      // Already retried once (or there's no request to retry) - a second
      // 401 means the refresh itself didn't fix it. Give up.
      clearTokens();
      redirectToLogin();
      return Promise.reject(error);
    }

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearTokens();
      redirectToLogin();
      return Promise.reject(error);
    }

    // If a refresh is already in flight (e.g. 3 requests 401'd at once),
    // queue this one instead of firing a second /refresh call - refresh
    // tokens are rotated server-side, so a second concurrent call would
    // race the first and one of them would fail.
    if (isRefreshing) {
      return new Promise((resolve) => {
        queueRequest((newAccessToken) => {
          originalRequest._retry = true;
          originalRequest.headers.set('Authorization', `Bearer ${newAccessToken}`);
          resolve(apiClient(originalRequest));
        });
      });
    }

    isRefreshing = true;
    originalRequest._retry = true;

    try {
      // Plain axios, not apiClient - calling through apiClient here would
      // re-enter this same interceptor if the refresh call itself 401s.
      const res = await axios.post('/api/auth/refresh', { refreshToken });
      const { accessToken, refreshToken: newRefreshToken } = res.data;
      setTokens(accessToken, newRefreshToken);

      isRefreshing = false;
      resolveQueue(accessToken);

      originalRequest.headers.set('Authorization', `Bearer ${accessToken}`);
      return apiClient(originalRequest);
    } catch (refreshErr) {
      isRefreshing = false;
      pendingRequests = [];
      clearTokens();
      redirectToLogin();
      return Promise.reject(refreshErr);
    }
  }
);

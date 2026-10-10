# @errsight/sdk

JavaScript SDK for ErrSight. Works in the browser and in Node.js.

## Install

```bash
npm install @errsight/sdk
```

## Usage

```ts
import ErrSight from '@errsight/sdk';

ErrSight.init({
  apiKey: 'es_your_project_api_key',
  environment: 'production',
  release: '1.4.2',
  userId: 'user_123',
  beforeSend(event) {
    // return null to drop the event entirely
    return event;
  },
});

ErrSight.addBreadcrumb('User clicked checkout', { cartSize: 3 });

try {
  riskyOperation();
} catch (err) {
  ErrSight.captureException(err as Error, { orderId: 'ord_42' });
}
```

Uncaught exceptions and unhandled promise rejections are captured
automatically after `init()` - both `window.onerror` /
`unhandledrejection` in the browser, and `uncaughtException` /
`unhandledRejection` in Node.

## Notes

- Requires Node.js 18+ or a browser with native `fetch`.
- Never throws back into your app - a failed report is logged to the
  console, not surfaced as an error in your code.

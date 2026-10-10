export function Legal() {
  return (
    <div className="legal-page">
      <div className="legal-disclaimer">
        <strong>Template, not legal advice.</strong> This page is a
        placeholder covering the standard sections a product like this
        needs. It has not been reviewed by a lawyer and should be adapted
        to your actual data handling, jurisdiction, and business terms
        before you rely on it.
      </div>

      <h1>Privacy Policy</h1>
      <p>Last updated: [date]</p>

      <h2>What we collect</h2>
      <ul>
        <li>Account info: email address and name, provided at registration.</li>
        <li>
          Error data submitted by the SDK on your behalf: error messages,
          stack traces, environment/release labels, and a one-way hash of
          any end-user identifier you supply - never the raw identifier
          itself.
        </li>
        <li>
          We do not knowingly collect passwords, card numbers, or other
          sensitive personal data through error reports; free-text fields
          are automatically scanned and redacted for common patterns
          (emails, tokens, card-like numbers) before storage, but you are
          responsible for not passing sensitive data into error messages
          in the first place.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Solely to group, display, and alert on errors for the project that
        submitted them. We do not sell error data or use it for
        advertising.
      </p>

      <h2>Retention</h2>
      <p>[Define how long error events and resolved groups are kept.]</p>

      <h2>Your rights</h2>
      <p>
        [State how a user can request access to, export, or deletion of
        their account data - varies by jurisdiction, e.g. GDPR/CCPA.]
      </p>

      <hr />

      <h1>Terms &amp; Conditions</h1>
      <p>Last updated: [date]</p>
      <ul>
        <li>[Acceptable use - no illegal content, no abuse of the ingestion API.]</li>
        <li>[Account responsibility - you're responsible for your API key and its exposure.]</li>
        <li>[Service availability - provided "as is", no uptime guarantee unless stated.]</li>
        <li>[Termination - grounds on which an account may be suspended.]</li>
        <li>[Liability limits and governing jurisdiction.]</li>
      </ul>

      <hr />

      <h1>Cookie &amp; Local Storage Statement</h1>
      <p>
        The dashboard does not use cookies. It stores your session token
        in your browser's <code>localStorage</code> so you stay signed in
        between visits. This token is readable only by scripts running on
        this site's own origin, is cleared automatically when it expires
        or when you log out, and is never sent to any third party.
      </p>
    </div>
  );
}

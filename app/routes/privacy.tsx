import { useLoaderData } from "react-router";
import { LegalLayout } from "../components/LegalLayout";
import { legalConfig } from "../legal.server";

export const loader = () => legalConfig();

export const meta = () => [{ title: "Privacy Policy – SFTP Order Export" }];

export default function Privacy() {
  const c = useLoaderData<typeof loader>();

  return (
    <LegalLayout title="Privacy Policy" updated={c.updated}>
      <p>
        SFTP Order Export (the “App”) is operated by {c.entity} (“we”, “us”).
        The App is a Shopify app that turns new orders into CSV files and
        uploads them to an SFTP server chosen by the merchant. This policy
        explains what data the App handles and why.
      </p>

      <h2>1. Roles</h2>
      <p>
        The merchant (the store owner who installs the App) decides what
        customer and order data is exported and where it goes, and is the
        controller of that data. We process it on the merchant’s behalf as a
        processor (service provider). For the merchant’s own account and
        configuration data described below, we are the controller.
      </p>

      <h2>2. Data we handle</h2>
      <h3>Stored by the App</h3>
      <ul>
        <li>The store’s Shopify domain and Shopify access tokens (encrypted).</li>
        <li>
          Details Shopify provides about staff who use the App, such as name,
          email address, locale and whether they are the account owner.
        </li>
        <li>
          SFTP settings: host, port, username, target folder, file name
          template and the selected CSV columns.
        </li>
        <li>
          SFTP credentials: a password, or a private key and optional
          passphrase (encrypted), and the fingerprint of the SFTP server’s
          SSH host key.
        </li>
        <li>
          Export history: the order number, the time, whether the export
          succeeded or failed, and any technical error message.
        </li>
      </ul>

      <h3>Processed but not stored</h3>
      <p>
        When an order is created, Shopify sends us the order details. The App
        reads only the fields the merchant selected for the CSV. Depending on
        that selection this can include the customer’s name, email address,
        phone number, shipping and billing addresses, items, totals, notes and
        tags. The CSV is built in memory and uploaded to the merchant’s SFTP
        server. We do not keep a copy. Our server logs may record the store
        domain, order ID and technical error messages, but not the order
        contents.
      </p>

      <h3>What we do not do</h3>
      <p>
        We do not collect data from shoppers or store visitors, run
        advertising or analytics trackers, build profiles, make automated
        decisions about people, or sell or share personal data for marketing.
      </p>

      <h2>3. Why we use the data</h2>
      <ul>
        <li>To provide the App: connect to the SFTP server and deliver files.</li>
        <li>To show merchants their export history and diagnose failures.</li>
        <li>To keep the App secure and prevent abuse.</li>
        <li>To respond to support requests and meet legal obligations.</li>
      </ul>

      <h2>4. Who receives data</h2>
      <ul>
        <li>
          <strong>Shopify</strong>, which provides the platform and sends us
          order data.
        </li>
        <li>
          <strong>Our hosting provider</strong> (Render), which runs the App
          and its database in {c.region}.
        </li>
        <li>
          <strong>The merchant’s SFTP server.</strong> The merchant chooses
          it and controls how it stores and protects the files. We have no
          control over that server.
        </li>
      </ul>
      <p>
        We disclose data to others only when the law requires it. Where data
        is processed outside the merchant’s country, we rely on the transfer
        safeguards offered by our hosting provider.
      </p>

      <h2>5. Security</h2>
      <ul>
        <li>
          SFTP passwords, private keys and Shopify tokens are encrypted at
          rest with AES-256-GCM, and each value is bound to its store.
        </li>
        <li>Data is encrypted in transit (HTTPS and SSH).</li>
        <li>
          The App remembers each SFTP server’s SSH host key and refuses to
          connect if it changes, and it only reuses a saved credential for
          the server it was saved for.
        </li>
        <li>
          The App refuses to connect to private or internal network
          addresses, limits connection tests, and only requests the Shopify
          permission it needs to read orders.
        </li>
        <li>
          The database is not reachable from the public internet, and every
          request is scoped to the store that made it.
        </li>
      </ul>
      <p>No system is perfectly secure, but we work to protect your data.</p>

      <h2>6. Retention</h2>
      <ul>
        <li>
          Settings, credentials and tokens are deleted when the App is
          uninstalled, and again when Shopify sends its store-deletion
          request about 48 hours later.
        </li>
        <li>
          Export history is deleted automatically after {c.retentionDays}{" "}
          days.
        </li>
        <li>
          Our hosting provider’s database backups and logs may retain removed
          data for a short time, no longer than 7 days.
        </li>
        <li>
          Order contents are not retained by the App after the file has been
          sent.
        </li>
      </ul>

      <h2>7. Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access,
        correct, delete or restrict the use of your personal data, to object
        to its processing, and to complain to a data protection authority.
        Merchants can contact us at the address below. Shoppers should contact
        the merchant they bought from, who controls their order data; we act
        on the merchant’s instructions and on the data requests Shopify
        forwards to us (customer data requests, customer redaction and store
        redaction). Because the App does not keep customer order data, the
        only related record is the order number in the export history, which
        is deleted with the store’s data.
      </p>
      <p>
        Our legal bases are performing our contract with the merchant and our
        legitimate interests in running a secure service. We do not sell
        personal data.
      </p>

      <h2>8. Children</h2>
      <p>The App is for businesses and is not directed at children.</p>

      <h2>9. Changes</h2>
      <p>
        We may update this policy. The date at the top shows the latest
        version, and we will notify merchants of material changes.
      </p>

      <h2>10. Contact</h2>
      <p>
        {c.entity}
        <br />
        {c.email}
      </p>
    </LegalLayout>
  );
}

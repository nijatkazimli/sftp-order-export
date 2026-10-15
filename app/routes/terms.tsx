import { useLoaderData } from "react-router";
import { LegalLayout } from "../components/LegalLayout";
import { legalConfig } from "../legal.server";

export const loader = () => legalConfig();

export const meta = () => [{ title: "Terms of Service – SFTP Order Export" }];

export default function Terms() {
  const c = useLoaderData<typeof loader>();

  return (
    <LegalLayout title="Terms of Service" updated={c.updated}>
      <p>
        These terms govern your use of SFTP Order Export (the “App”), operated
        by {c.entity} (“we”, “us”). By installing or using the App you agree
        to them on behalf of your business (“you”). If you do not agree, do
        not install the App.
      </p>

      <h2>1. The service</h2>
      <p>
        The App creates a CSV file for each new Shopify order and uploads it
        to an SFTP server that you configure. You choose the server, the
        folder, the file name and the columns.
      </p>

      <h2>2. Your responsibilities</h2>
      <ul>
        <li>
          You must have the right to use the Shopify store and the SFTP
          server you connect, and to send customer and order data to it.
        </li>
        <li>
          You are responsible for the lawfulness of exporting that data,
          including informing your customers and complying with applicable
          privacy law, and for the security of your SFTP server and the people
          who can read its files.
        </li>
        <li>
          You must keep your SFTP details accurate and monitor the export
          history in the App. We cannot know that a supplier’s system has
          failed to process a file we delivered.
        </li>
        <li>You are responsible for activity under your store’s account.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You must not use the App to:</p>
      <ul>
        <li>break the law or infringe anyone’s rights;</li>
        <li>
          scan, probe or attack servers or networks, or try to reach systems
          you are not authorised to use;
        </li>
        <li>
          bypass the App’s security controls or limits, or interfere with its
          operation.
        </li>
      </ul>
      <p>We may suspend access if you breach these terms or put the service at risk.</p>

      <h2>4. Data protection</h2>
      <p>
        For customer and order data, you are the controller and we are your
        processor. We will:
      </p>
      <ul>
        <li>
          process that data only to provide the App and on your documented
          instructions (your configuration and use of the App);
        </li>
        <li>
          keep it confidential and protect it as described in our{" "}
          <a href="/privacy">Privacy Policy</a>;
        </li>
        <li>
          use only the sub-processors listed there (our hosting provider) and
          remain responsible for them;
        </li>
        <li>
          help you respond to data subject requests, including those Shopify
          forwards to us;
        </li>
        <li>
          delete store data after uninstall as set out in the Privacy Policy;
        </li>
        <li>
          tell you without undue delay if we become aware of a breach affecting
          your data.
        </li>
      </ul>

      <h2>5. Availability</h2>
      <p>
        We work to keep the App available but do not promise uninterrupted
        service. When an upload fails, the App retries automatically for up to
        {c.retryDays} days, and the outcome appears in your export history. We
        do not guarantee that a file will be delivered, accepted or processed
        by your SFTP server or any third party.
      </p>

      <h2>6. Fees</h2>
      <p>
        If the App has a charge, it is billed through Shopify, and we will
        tell you before any change takes effect.
      </p>

      <h2>7. Third-party services</h2>
      <p>
        The App depends on Shopify and on your SFTP server. We are not
        responsible for their availability, changes or conduct, and you must
        follow Shopify’s terms.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        We own the App. You keep all rights in your data. We give you a
        limited, non-exclusive, non-transferable right to use the App for
        your business while these terms apply.
      </p>

      <h2>9. Ending the agreement</h2>
      <p>
        You can stop at any time by uninstalling the App. We may end or
        suspend the service for the reasons in section 3 or on reasonable
        notice. Our handling of your data after that is described in the
        Privacy Policy.
      </p>

      <h2>10. Disclaimers</h2>
      <p>
        The App is provided “as is” and “as available”. To the extent the law
        allows, we disclaim all warranties, including fitness for a
        particular purpose and non-infringement.
      </p>

      <h2>11. Limit of liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or
        consequential losses, lost profits or lost data, and our total
        liability for any claim is limited to the greater of the fees you paid
        for the App in the 12 months before the claim and USD 100. Nothing
        here limits liability that cannot be limited by law.
      </p>

      <h2>12. Indemnity</h2>
      <p>
        You will cover claims and costs arising from your breach of these
        terms or from your use of the App to export data you had no right to
        export.
      </p>

      <h2>13. Changes</h2>
      <p>
        We may update these terms. The date at the top shows the latest
        version. If you keep using the App after a change takes effect, you
        accept it; we will notify you of material changes.
      </p>

      <h2>14. Governing law</h2>
      <p>These terms are governed by {c.law}.</p>

      <h2>15. Contact</h2>
      <p>
        {c.entity}
        <br />
        {c.email}
      </p>
    </LegalLayout>
  );
}

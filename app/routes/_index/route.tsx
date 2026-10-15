import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = actionData?.errors;

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>SFTP Order Export</h1>
        <p className={styles.text}>
          Send every new Shopify order to your warehouse or supplier as a CSV
          file on their SFTP server.
        </p>
        {showForm && (
          <Form className={styles.form} method="post">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>{errors?.shop ?? "e.g: my-shop-domain.myshopify.com"}</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Automatic exports</strong>. Each new order becomes a CSV file
            uploaded to your SFTP server as soon as it is created.
          </li>
          <li>
            <strong>Your format</strong>. Choose the columns, their order and
            names, and how files are named.
          </li>
          <li>
            <strong>Secure by design</strong>. Credentials are encrypted, server
            keys are pinned, and order data is never stored.
          </li>
        </ul>
        <p className={styles.legal}>
          <a href="/privacy">Privacy policy</a> ·{" "}
          <a href="/terms">Terms of service</a>
        </p>
      </div>
    </div>
  );
}

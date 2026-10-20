# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
reporting instead: open the repository's **Security** tab and choose **Report a
vulnerability**. Include what you found, how to reproduce it, and the impact you
expect.

This is a spare-time open source project. Reports are read and answered on a
best-effort basis, with no guaranteed response time.

## Scope

In scope: this repository's code, including how it stores and encrypts SFTP
credentials and Shopify tokens, handles webhooks, connects to SFTP servers, and
builds export files.

Out of scope: problems in your own deployment (hosting, database, secrets
handling, SFTP servers) and vulnerabilities in third-party dependencies that are
not reachable through this code. Report those to the relevant project.

## Running this yourself

If you deploy this app you are the operator and are responsible for securing it:
keep `ENCRYPTION_KEY` secret and backed up, use a separate key and database for
every environment, apply dependency updates, and restrict access to your hosting
account. See the Operations section of the README.

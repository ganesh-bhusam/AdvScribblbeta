# VPS Setup & Troubleshooting Log

This file contains the record of what we did to get the VPS up and running, in case you ever need to do it again!

## 1. Initial Connection Issues
- **Problem:** Attempting to `ssh root@162.35.184.176` resulted in a `Connection timed out` and later `Connection refused`.
- **Cause:** The default OS installation from InterServer was likely stuck or the security firewall (`fail2ban`) blocked the connection because of a failed password attempt.
- **Solution:** We used the **"Reinstall OS"** button from the InterServer Control Panel to wipe the server and install a fresh copy of **Ubuntu 22.04 / 24.04**. This provided a clean slate and a brand new `root` password via email.

## 2. "Remote Host Identification Has Changed" Warning
- **Problem:** After the reinstallation, the terminal threw a massive warning about a potential Man-in-the-Middle attack and refused to connect.
- **Cause:** The server generated a new security fingerprint when it was reinstalled, but the local computer remembered the old one from the first attempt.
- **Solution:** We cleared the old fingerprint by running this command in the local Windows PowerShell:
  ```bash
  ssh-keygen -R 162.35.184.176
  ```

## 3. Successful Login
- We ran `ssh root@162.35.184.176`.
- Typed `yes` to accept the new security fingerprint.
- Carefully right-clicked to paste the new password from the email (remembering that the password is invisible while typing).
- Successfully logged into the Ubuntu 24.04 root prompt!

---

*For the actual deployment commands to get the game running, please refer to the `VPS_DEPLOYMENT.md` file.*

import type { ReactNode } from "react";
import { Dialog } from "./ui/dialog";

/**
 * Explains why an existing key cannot be re-shown. Only creation and rotation
 * responses carry plaintext; list rows intentionally carry public metadata only.
 */
export function ApiKeyUnavailableSecretDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Key cannot be revealed"
      description="Existing API-key plaintext is not recoverable from the console."
      size="md"
    >
      <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>
        For your security, the console never stores plaintext API keys after they are created or
        rotated. This list only has the public key prefix, so there is no secret to reveal. Create
        or rotate the key to receive a new secret, then copy or save it before closing the dialog.
      </p>
    </Dialog>
  );
}

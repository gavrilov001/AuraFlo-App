"use client";

import { useState, useTransition } from "react";
import { Copy, RotateCcw } from "lucide-react";

import type { SenderEmailSummary } from "@/lib/types/database.types";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { FormMessage } from "@/components/ui/FormMessage";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  addSenderEmailAction,
  removeSenderEmailAction,
  regenerateInboundAliasAction,
  requestPrimaryEmailVerificationAction,
  resendSenderEmailVerificationAction,
} from "./sender-emails-actions";

const MAX_ADDITIONAL = 2;

function StatusBadge({ verified }: { verified: boolean }) {
  return (
    <Badge tone={verified ? "soft" : "muted"}>
      {verified ? "Verified" : "Pending"}
    </Badge>
  );
}

export function SenderEmailsSection({
  primaryEmail,
  primaryVerified,
  inboundAddress,
  dreamAddress,
  initialSenderEmails,
}: {
  primaryEmail: string;
  primaryVerified: boolean;
  inboundAddress: string;
  dreamAddress: string | null;
  initialSenderEmails: SenderEmailSummary[];
}) {
  const toast = useToast();
  const [senderEmails, setSenderEmails] = useState(initialSenderEmails);
  const [address, setAddress] = useState(inboundAddress);
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const setBusy = (id: string, value: boolean) =>
    setBusyIds((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });

  function copyAddress() {
    void navigator.clipboard
      .writeText(address)
      .then(() => toast.success("Address copied."))
      .catch(() => toast.error("Couldn't copy to clipboard."));
  }

  function copyDreamAddress() {
    if (!dreamAddress) return;
    void navigator.clipboard
      .writeText(dreamAddress)
      .then(() => toast.success("Address copied."))
      .catch(() => toast.error("Couldn't copy to clipboard."));
  }

  function requestPrimaryVerification() {
    setBusy("primary", true);
    startTransition(() => {
      void requestPrimaryEmailVerificationAction().then((r) => {
        setBusy("primary", false);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        if (r.data.emailSent) {
          toast.success("Verification email sent.");
        } else {
          toast.error(
            "We couldn't send the verification email just now — wait a moment and press Verify again.",
          );
        }
      });
    });
  }

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setFieldError(undefined);
    startTransition(() => {
      void addSenderEmailAction({ email }).then((r) => {
        if (!r.ok) {
          if (r.fieldErrors?.email) setFieldError(r.fieldErrors.email);
          else setFormError(r.error);
          return;
        }
        setSenderEmails((current) => [
          ...current,
          { id: r.data.id, email, status: "pending", created_at: new Date().toISOString() },
        ]);
        setEmail("");
        if (r.data.emailSent) {
          toast.success("Verification email sent.");
        } else {
          // The address was added — it's already visible above, Pending —
          // but the email itself didn't go out. Resend (below) is the safe
          // retry: nothing was lost or duplicated.
          toast.error("Address added, but we couldn't send the verification email. Press Resend to try again.");
        }
      });
    });
  }

  function handleResend(id: string) {
    setBusy(id, true);
    startTransition(() => {
      void resendSenderEmailVerificationAction({ id }).then((r) => {
        setBusy(id, false);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        if (r.data.emailSent) {
          toast.success("Verification email sent.");
        } else {
          toast.error("We couldn't send the verification email just now. Try Resend again shortly.");
        }
      });
    });
  }

  function handleRemove(id: string) {
    setConfirmRemoveId(null);
    setBusy(id, true);
    startTransition(() => {
      void removeSenderEmailAction({ id }).then((r) => {
        setBusy(id, false);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setSenderEmails((current) => current.filter((s) => s.id !== id));
        toast.success("Address removed.");
      });
    });
  }

  function handleRegenerate() {
    setConfirmRegenerate(false);
    startTransition(() => {
      void regenerateInboundAliasAction().then((r) => {
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setAddress((prev) => {
          const domain = prev.split("@")[1] ?? "";
          return `${r.data.inboundAlias}@${domain}`;
        });
        toast.success("Your Dream Catcher address was regenerated. The old one no longer works.");
      });
    });
  }

  const atLimit = senderEmails.length >= MAX_ADDITIONAL;

  return (
    <div className="flex flex-col gap-6">
      {dreamAddress && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-ink">Your Dream Catcher address</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-line bg-surface-soft px-2.5 py-1.5 text-[13px] text-body">
              {dreamAddress}
            </code>
            <Button variant="secondary" size="sm" onClick={copyDreamAddress}>
              <Copy aria-hidden className="size-3.5" />
              Copy
            </Button>
          </div>
          <p className="text-[13px] text-muted">
            Thoughts sent from your verified emails below to this address land in Dream
            Catcher. This address is assigned to you and can&apos;t be changed.
          </p>
        </div>
      )}

      <div className={`flex flex-col gap-1.5 ${dreamAddress ? "border-t border-line-soft pt-5" : ""}`}>
        <p className="text-sm font-medium text-ink">
          {dreamAddress ? "Legacy Dream Catcher address" : "Your Dream Catcher address"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md border border-line bg-surface-soft px-2.5 py-1.5 text-[13px] text-body">
            {address}
          </code>
          <Button variant="secondary" size="sm" onClick={copyAddress}>
            <Copy aria-hidden className="size-3.5" />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmRegenerate(true)}
          >
            <RotateCcw aria-hidden className="size-3.5" />
            Regenerate
          </Button>
        </div>
        <p className="text-[13px] text-muted">
          Send or forward an email here from any verified address below to add it to
          your Dream Catcher inbox. Regenerating revokes the old address immediately.
        </p>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line-soft pt-5">
        <p className="text-sm font-medium text-ink">Approved sender addresses</p>

        <div className="flex items-center justify-between gap-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-body">{primaryEmail}</span>
            <Badge tone="muted">Primary</Badge>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge verified={primaryVerified} />
            {!primaryVerified && (
              <Button
                variant="secondary"
                size="sm"
                loading={busyIds.has("primary") && pending}
                onClick={requestPrimaryVerification}
              >
                Verify
              </Button>
            )}
          </div>
        </div>

        {senderEmails.map((sender) => (
          <div
            key={sender.id}
            className="flex items-center justify-between gap-3 py-1.5"
          >
            <span className="text-sm text-body">{sender.email}</span>
            <div className="flex items-center gap-2">
              <StatusBadge verified={sender.status === "verified"} />
              {sender.status !== "verified" && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busyIds.has(sender.id) && pending}
                  onClick={() => handleResend(sender.id)}
                >
                  Resend
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                loading={busyIds.has(sender.id) && pending}
                onClick={() => setConfirmRemoveId(sender.id)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-3 border-t border-line-soft pt-5"
        noValidate
      >
        {formError && <FormMessage tone="error">{formError}</FormMessage>}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <TextField
              label="Add another address"
              name="email"
              type="email"
              placeholder="you@work.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={fieldError}
              disabled={atLimit}
            />
          </div>
          <Button type="submit" loading={pending} disabled={atLimit || !email}>
            Add &amp; send verification
          </Button>
        </div>
        {atLimit && (
          <p className="text-[13px] text-muted">
            You&apos;ve reached the limit of {MAX_ADDITIONAL} additional addresses. Remove one
            to add another.
          </p>
        )}
      </form>

      <ConfirmDialog
        open={confirmRemoveId !== null}
        title="Remove this address?"
        description="Emails from this address will no longer reach your Dream Catcher."
        confirmLabel="Remove"
        destructive
        onConfirm={() => confirmRemoveId && handleRemove(confirmRemoveId)}
        onCancel={() => setConfirmRemoveId(null)}
      />

      <ConfirmDialog
        open={confirmRegenerate}
        title="Regenerate your Dream Catcher address?"
        description="Your current address will stop working immediately. Update anywhere you've saved it."
        confirmLabel="Regenerate"
        destructive
        onConfirm={handleRegenerate}
        onCancel={() => setConfirmRegenerate(false)}
      />
    </div>
  );
}

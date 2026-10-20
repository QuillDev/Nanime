import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import type { AgentKey } from "../../shared/types.ts";
import type { CreatedAgentKey, McpCommand } from "../agentKeysApi.ts";
import { useCreateAgentKey, useRevokeAgentKey } from "../hooks/useAgentKeys.ts";
import { hermesConfig } from "../lib/agentConfig.ts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";

const primaryButton = "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-semibold text-background hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground";
const quietButton = "h-10 rounded-lg px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground";

interface CreatedProps {
  readonly created: CreatedAgentKey;
  readonly mcp: McpCommand;
  readonly origin: string;
  readonly onDone: () => void;
}

/** The new key inside a ready-to-paste Hermes config, shown once. */
export function AgentKeyCreated({ created, mcp, origin, onDone }: CreatedProps): React.JSX.Element {
  const config = hermesConfig(mcp, origin, created.key);
  const [copy, setCopy] = useState<"copied" | "failed" | "idle">("idle");
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(config);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }, [config]);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Key for {created.agentKey.name}</DialogTitle>
        <DialogDescription>Add this to Hermes’s config.yaml. The key can’t be shown again after you close this.</DialogDescription>
      </DialogHeader>
      <pre aria-label="Hermes MCP config" className="max-h-72 select-all overflow-auto whitespace-pre rounded-lg bg-secondary p-3 font-mono text-xs leading-relaxed text-foreground">{config}</pre>
      {copy === "failed" && <p className="text-sm text-destructive">Copy failed. Select the config and copy it manually.</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className={quietButton}>Done</button>
        <button type="button" onClick={handleCopy} className={primaryButton}>
          {copy === "copied" ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copy === "copied" ? "Copied" : "Copy config"}
        </button>
      </div>
    </>
  );
}

function NewKeyForm({ onCreated }: { readonly onCreated: (created: CreatedAgentKey) => void }): React.JSX.Element {
  const [name, setName] = useState("");
  const create = useCreateAgentKey();
  const handleName = useCallback((event: ChangeEvent<HTMLInputElement>) => setName(event.target.value), []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(name.trim(), { onSuccess: onCreated });
  }, [create, name, onCreated]);
  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New agent key</DialogTitle>
        <DialogDescription>An agent with this key can search sources and manage downloads as you.</DialogDescription>
      </DialogHeader>
      <label htmlFor="agent-key-name" className="text-sm font-medium">
        Name
        <Input id="agent-key-name" value={name} onChange={handleName} maxLength={60} placeholder="Hermes" autoComplete="off" required className="mt-2" />
      </label>
      {create.error !== null && <p className="select-text text-sm text-destructive">{create.error.message}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={name.trim() === "" || create.isPending} className={primaryButton}>
          {create.isPending ? "Creating…" : "Create key"}
        </button>
      </div>
    </form>
  );
}

interface NewKeyProps {
  readonly mcp: McpCommand;
  readonly onClose: () => void;
}

export function NewAgentKeyDialog({ mcp, onClose }: NewKeyProps): React.JSX.Element {
  const [created, setCreated] = useState<CreatedAgentKey | null>(null);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      onClose();
    }
  }, [onClose]);
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        {created === null
          ? <NewKeyForm onCreated={setCreated} />
          : <AgentKeyCreated created={created} mcp={mcp} origin={globalThis.location.origin} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

export function RevokeAgentKeyDialog({ agentKey }: { readonly agentKey: AgentKey }): React.JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const revoke = useRevokeAgentKey();
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleOpenChange = useCallback((nextOpen: boolean) => setOpen(nextOpen), []);
  const handleKeep = useCallback(() => setOpen(false), []);
  const handleRevoke = useCallback(() => {
    revoke.mutate(agentKey.id, { onSuccess: () => setOpen(false) });
  }, [agentKey.id, revoke]);
  return (
    <>
      <button type="button" onClick={handleOpen} className="h-8 shrink-0 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-destructive">
        Revoke
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke {agentKey.name}?</DialogTitle>
            <DialogDescription>The agent using this key loses access right away.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={handleKeep} className={quietButton}>Keep key</button>
            <button type="button" onClick={handleRevoke} disabled={revoke.isPending} className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:bg-muted disabled:text-muted-foreground">
              {revoke.isPending ? "Revoking…" : "Revoke key"}
            </button>
          </div>
          {revoke.status === "error" && <p className="text-sm text-destructive">{revoke.error.message}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}

export type SessionMode = 'idle' | 'managed' | 'attached';
export type ActKind = 'click' | 'type' | 'press';

export type ActArgs = {
  ref: string;
  kind: ActKind;
  value?: string;
};

export type GotoResult = { ok: true; url: string } | { ok: false; error: string; url?: string };

export type SnapshotNode = {
  ref: string;
  role: string;
  name: string;
  states?: string[];
};

export type SnapshotResult = {
  text: string;
  nodes: SnapshotNode[];
  url: string;
};

export class AgentBrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBrowserError';
  }
}

export type OfficialMessageButtonAction =
  | { type: "OPEN_URL"; url: string }
  | { type: "NAVIGATE"; route: string };

export interface OfficialMessageButton {
  label: string;
  action: OfficialMessageButtonAction;
}

export interface OfficialMessageMetadata {
  buttons?: OfficialMessageButton[];
}

export interface BroadcastOfficialMessageInput {
  body: string;
  buttons?: OfficialMessageButton[];
  mediaId?: string | undefined;
}

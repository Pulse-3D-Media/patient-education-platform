/**
 * Where a video's captions stand, and the words the video's page on /pulse
 * says for each. A plain module with no server imports, so the page's card
 * (a browser component) and lib/mux-captions.ts (server only, which works
 * the state out from what Mux says) share one list.
 */
export type CaptionState =
  | { kind: "checking" } // the page is on screen and Mux is being asked (streamed in a moment later)
  | { kind: "not-mux" } // plays from the CDN or has no file: no captions (a CDN MP4 carries none)
  | { kind: "not-configured" } // the Mux access token is not set on this deployment, so Mux cannot be asked
  | { kind: "no-asset-id" } // a playback id pasted by hand with no asset id beside it
  | { kind: "unreachable" } // Mux did not answer, does not know the asset, or could not prepare it
  | { kind: "video-not-ready" } // Mux is still preparing the video itself
  | { kind: "no-sound" } // the asset has no sound track to write captions from
  | { kind: "none" }
  | { kind: "being-made" }
  | { kind: "failed" }
  | { kind: "ready"; reviewUrl: string | null; name: string };

/** The line under "Captions" on the video's page. */
export const CAPTION_STATE_WORDS: Record<CaptionState["kind"], string> = {
  checking: "Checking with Mux...",
  "not-mux": "None. Captions come from Mux, and this video does not play from Mux (a CDN file has no captions). Upload its file to Mux to get them.",
  "not-configured": "Mux is not set up on this deployment (the access token or the signing key is missing), so captions cannot be checked or asked for here.",
  "no-asset-id": "Unknown. This video's Mux asset id is not on its row, so Mux cannot be asked. Copy it from the asset's page in the Mux dashboard into the Mux asset id box below and save.",
  unreachable: "Could not check just now: Mux did not answer in time, or could not prepare this video. Check again in a moment.",
  "video-not-ready": "Not yet. Mux is still preparing the video; captions can be asked for once it is ready.",
  "no-sound": "None. This video has no sound track in Mux, so there is no narration to write captions from.",
  none: "None yet. Mux can write English captions from the narration.",
  "being-made": "Being made by Mux. This usually takes a few minutes; reload the page to see when they are ready.",
  failed: "Mux could not make captions for this video. Ask again, or upload the file again to get captions.",
  ready: "Ready. Patients and surgeons can turn them on with the CC button on the video.",
};

/** Whether "Add captions" is offered in this state. */
export function canAskForCaptions(state: CaptionState): boolean {
  return state.kind === "none" || state.kind === "failed";
}

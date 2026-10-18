import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { Passkey } from "../shared/auth";
import { api } from "./api";
import { t } from "./i18n";

/** Passkeys need a secure context (HTTPS or localhost). */
export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

/** The user closed the browser's passkey dialog (or it timed out); not worth an error message. */
export function passkeyCancelled(error: unknown): boolean {
  return error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");
}

/** Names a passkey after the browser and system it was created on, e.g. „Safari auf Mac“. */
export function deviceName(userAgent: string): string {
  const system = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Macintosh|Mac OS X/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  if (browser && system) return t("passkeys.deviceName", { browser, system });
  return browser ?? system ?? "Passkey";
}

export async function createPasskey(): Promise<Passkey> {
  const { challengeId, options } = await api.passkeyRegistration();
  const response = await startRegistration({ optionsJSON: options });
  return api.registerPasskey(challengeId, response, deviceName(navigator.userAgent));
}

export async function loginWithPasskey(name: string | null): Promise<void> {
  const { challengeId, options } = await api.passkeyLogin(name);
  const response = await startAuthentication({ optionsJSON: options });
  await api.loginWithPasskey(challengeId, response);
}

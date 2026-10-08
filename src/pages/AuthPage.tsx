import { useSearchParams } from "react-router";
import { AuthEntry } from "@/components/auth/auth-entry";
import { WallpaperLayer } from "@/components/panel/wallpaper-layer";
import { DEFAULT_THEME } from "@contracts/panel/types";
import { usePublicSettings } from "./PanelPage";

/** Signed-out flow: login / register / forgot / reset, mirroring the
 *  per-page props of the original Next.js auth pages. */
export default function AuthPage({ mode }: { mode: "login" | "register" | "forgot" | "reset" }) {
  const settings = usePublicSettings();
  const [searchParams] = useSearchParams();
  if (!settings) {
    return (
      <div className="relative min-h-dvh" aria-busy="true">
        <WallpaperLayer theme={DEFAULT_THEME} />
      </div>
    );
  }
  const firstUser = settings.firstUser;
  if (mode === "login") {
    return (
      <AuthEntry
        mode="login"
        theme={settings.theme}
        panelName={settings.panelName}
        panelLogo={settings.panelLogo}
        title="Sign In to {panel}"
        subtitle="Enter your credentials to access the panel"
        allowRegistration={settings.allowRegistration}
        demos={settings.demos}
        google={settings.google}
      />
    );
  }
  if (mode === "register") {
    const open = firstUser || settings.allowRegistration;
    return (
      <AuthEntry
        mode="register"
        theme={settings.theme}
        panelName={settings.panelName}
        panelLogo={settings.panelLogo}
        title={firstUser ? "Create the owner account" : "Join {panel}"}
        subtitle={
          firstUser
            ? "The first account becomes the panel owner"
            : "Create a member account to manage panel resources"
        }
        registrationOpen={open}
        firstUser={firstUser}
      />
    );
  }
  if (mode === "forgot") {
    return (
      <AuthEntry
        mode="forgot"
        theme={settings.theme}
        panelName={settings.panelName}
        panelLogo={settings.panelLogo}
        title="Reset your password"
        subtitle="We'll email you a link to choose a new one"
        passwordResetEnabled={settings.passwordResetEnabled}
      />
    );
  }
  return (
    <AuthEntry
      mode="reset"
      theme={settings.theme}
      panelName={settings.panelName}
      panelLogo={settings.panelLogo}
      title="Choose a new password"
      subtitle="Enter the new password for your account"
      resetToken={searchParams.get("token") ?? ""}
    />
  );
}

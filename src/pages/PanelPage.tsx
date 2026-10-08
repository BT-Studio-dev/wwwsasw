import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { ClientGate } from "@/components/panel/client-gate";
import { WallpaperLayer } from "@/components/panel/wallpaper-layer";
import { DEFAULT_THEME, resolveSettingsTab, type PanelView, type ThemeSettings } from "@contracts/panel/types";
import { api } from "@/lib/utils";

type PublicSettings = {
  theme: ThemeSettings;
  panelName: string;
  panelLogo: string;
  allowRegistration: boolean;
  passwordResetEnabled: boolean;
  firstUser: boolean;
  google: { googleOauthEnabled: boolean; googleClientId: string };
};

let publicSettingsCache: PublicSettings | null = null;

// eslint-disable-next-line react-refresh/only-export-components -- Shared by both the panel and auth route components.
export function usePublicSettings(): PublicSettings | null {
  const [settings, setSettings] = useState<PublicSettings | null>(publicSettingsCache);
  useEffect(() => {
    if (publicSettingsCache) return;
    let cancelled = false;
    api<PublicSettings>("/api/public-settings")
      .then((data) => {
        publicSettingsCache = data;
        if (!cancelled) setSettings(data);
      })
      .catch(() => {
        if (!cancelled)
          setSettings({
            theme: DEFAULT_THEME,
            panelName: "BT Panel",
            panelLogo: "",
            allowRegistration: true,
            passwordResetEnabled: true,
            firstUser: true,
            google: { googleOauthEnabled: false, googleClientId: "" },
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return settings;
}

/** Signed-in panel surface. The gate paints the cached dashboard instantly
 *  and refreshes it via /api/bootstrap; signed-out visitors are bounced to
 *  /login exactly like the original server-rendered pages. */
export default function PanelPage({ view }: { view: PanelView }) {
  const params = useParams<{ tab?: string }>();
  const settings = usePublicSettings();
  if (!settings) {
    return (
      <div className="relative min-h-dvh" aria-busy="true">
        <WallpaperLayer theme={DEFAULT_THEME} />
      </div>
    );
  }
  return (
    <ClientGate
      theme={settings.theme}
      initialView={view}
      initialSettingsTab={view === "settings" ? resolveSettingsTab(params.tab) : undefined}
    />
  );
}

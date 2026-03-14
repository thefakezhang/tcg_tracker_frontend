"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { t } from "@/lib/i18n";
import type { Language } from "@/app/dashboard/LanguageContext";

function getStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem("language");
  return stored === "ja" ? "ja" : "en";
}

export default function LoginPage() {
  const lang = getStoredLanguage();
  const handleLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center">{t(lang, "app.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={handleLogin} className="w-full" size="lg">
            {t(lang, "app.signInWithGoogle")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircularProgress, Stack, Typography, Alert, Box } from "@mui/material";
import { clearPkceCodeVerifier, getPkceCodeVerifier } from "@/lib/pkce-storage";
import {
  fetchInstagramAccountsFromFacebook,
  mergeInstagramAccounts,
  persistInstagramAccounts,
  readStoredInstagramAccounts,
} from "@/lib/instagram-accounts";

export default function AuthCallback() {
  const router = useRouter();
  const [status, setStatus] = useState("Processing authentication...");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const errorParam = urlParams.get("error");
    const errorDescription = urlParams.get("error_description");

    console.log("[v0] Callback received, code:", code ? "present" : "missing");

    if (errorParam) {
      console.error("[v0] OAuth error:", errorParam, errorDescription);
      setError(`Authentication failed: ${errorDescription || errorParam}`);
      setTimeout(() => router.push("/"), 3000);
      return;
    }

    if (!code) {
      console.error("[v0] No authorization code received");
      setError("Authentication failed: No authorization code received");
      setTimeout(() => router.push("/"), 3000);
      return;
    }

    async function exchangeCodeForToken() {
      try {
        setStatus("Exchanging authorization code for access token...");
        console.log("[v0] Exchanging code for token with PKCE");

        const { codeVerifier, source } = getPkceCodeVerifier();
        const fbAppId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;

        console.log("[v0] PKCE verifier source:", source);

        if (!codeVerifier) {
          throw new Error(
            "PKCE code verifier not found. Please try logging in again."
          );
        }

        if (!fbAppId) {
          throw new Error("Facebook App ID not configured");
        }

        const redirectUri = `${window.location.origin}/auth/callback`;

        // Exchange code for access token using PKCE
        const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${fbAppId}&redirect_uri=${encodeURIComponent(
          redirectUri
        )}&code=${code}&code_verifier=${codeVerifier}`;

        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();

        console.log(
          "[v0] Token exchange response:",
          tokenData.access_token ? "success" : "failed"
        );

        if (tokenData.error) {
          throw new Error(
            tokenData.error.message || "Failed to exchange authorization code"
          );
        }

        if (!tokenData.access_token) {
          throw new Error("No access token received from Facebook");
        }

        const accessToken = tokenData.access_token;

        // Clear the code verifier from all storage locations
        clearPkceCodeVerifier();

        setStatus("Fetching Instagram accounts...");
        console.log("[v0] Fetching Instagram accounts");

        const fetchedIGAccounts =
          await fetchInstagramAccountsFromFacebook(accessToken);

        console.log(
          "[v0] Instagram accounts synced:",
          fetchedIGAccounts.length
        );

        if (fetchedIGAccounts.length === 0) {
          throw new Error(
            "No Instagram Business Account found. Please connect your Instagram Business accounts to Facebook Pages first."
          );
        }

        const existingIGAccounts = readStoredInstagramAccounts(localStorage);
        const mergedIGAccounts = mergeInstagramAccounts(
          existingIGAccounts,
          fetchedIGAccounts
        );

        persistInstagramAccounts(mergedIGAccounts, localStorage);

        const storedPrimaryId = localStorage.getItem("primary_ig_account_id");
        const storedSelectedId = localStorage.getItem("ig_user_id");
        const preferredAccount =
          mergedIGAccounts.find(
            (account) =>
              account.id === storedPrimaryId || account.id === storedSelectedId
          ) || fetchedIGAccounts[0];

        // Keep the legacy keys for the rest of the app, but store the user token
        // so we can refresh all connected pages/accounts later as well.
        localStorage.setItem("fb_access_token", accessToken);
        localStorage.setItem("ig_user_id", preferredAccount.id);

        if (preferredAccount.pageId) {
          localStorage.setItem("fb_page_id", preferredAccount.pageId);
        }

        if (
          !storedPrimaryId ||
          !mergedIGAccounts.some((account) => account.id === storedPrimaryId)
        ) {
          localStorage.setItem("primary_ig_account_id", preferredAccount.id);
        }

        console.log("[v0] Auth successful, redirecting to dashboard");
        setStatus(
          `Success! ${mergedIGAccounts.length} Instagram account(s) synced. Redirecting to dashboard...`
        );
        setTimeout(() => router.push("/dashboard"), 1000);
      } catch (error: any) {
        console.error("[v0] Auth error:", error);
        setError(error.message);
        setTimeout(() => router.push("/"), 5000);
      }
    }

    exchangeCodeForToken();
  }, [router]);

  return (
    <Stack
      height="100vh"
      alignItems="center"
      justifyContent="center"
      gap={3}
      sx={{ bgcolor: "#f5f5f5", p: 2 }}
    >
      {error ? (
        <Box maxWidth={600} width="100%">
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            Redirecting back to login...
          </Typography>
        </Box>
      ) : (
        <>
          <CircularProgress size={60} />
          <Typography variant="h6" textAlign="center" px={2}>
            {status}
          </Typography>
        </>
      )}
    </Stack>
  );
}

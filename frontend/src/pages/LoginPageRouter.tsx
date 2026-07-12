import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/authContext.tsx";
import { useAppReady } from "@/contexts/appReadyContext.tsx";
import { useIsMobile } from "@/lib/useIsMobile";
import { useThemeSeasonInfo, type SeasonInfo } from "@/lib/seasonTheme";
import LoginPageDesktop from "./LoginPageDesktop";
import LoginPageMobile from "./LoginPageMobile";

export type { SeasonInfo };

export interface TimeInfo {
    weekInfo?: string;
    dateRange: string;
}

export interface LoginPageProps {
    season: SeasonInfo | null;
    timeInfo: TimeInfo;
    loading: boolean;
    banned: boolean;
    pendingApproval: boolean;
    authError: boolean;
    signInWithGoogle: () => void;
}

/* ── Helpers ─────────────────────────────────────────────────── */
function getTimeInfo(): TimeInfo {
    const now = new Date();
    const kickoff      = new Date(2027, 0, 9);
    const buildEnd     = new Date(2027, 2, 1);
    const compEnd      = new Date(2027, 3, 15);
    const preWorldsEnd = new Date(2027, 4, 1);
    const worldsEnd    = new Date(2027, 4, 8);

    const fmt   = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const range = (a: Date, b: Date) => `${fmt(a)} — ${fmt(b)}`;
    const wk    = (d: Date) => Math.floor((d.getTime() - kickoff.getTime()) / (1000 * 60 * 60 * 24 * 7)) + 1;
    const pad   = (n: number) => String(n).padStart(2, "0");

    if (now < kickoff)      return { dateRange: "Kickoff Jan 9" };
    if (now < buildEnd)     return { dateRange: range(kickoff, buildEnd),      weekInfo: `WK ${pad(wk(now))} / ${wk(buildEnd)}` };
    if (now < compEnd)      return { dateRange: range(buildEnd, compEnd),      weekInfo: `WK ${pad(wk(now))} / ${wk(compEnd)}` };
    if (now < preWorldsEnd) return { dateRange: range(compEnd, preWorldsEnd) };
    if (now < worldsEnd)    return { dateRange: range(preWorldsEnd, worldsEnd) };
    return                         { dateRange: "May 2027+" };
}

/* ── Router ──────────────────────────────────────────────────── */
export default function LoginPageRouter() {
    const { user, loading, banned, pendingApproval, authError, signInWithGoogle } = useAuth();
    const navigate  = useNavigate();
    const markReady = useAppReady();
    const season    = useThemeSeasonInfo();
    const timeInfo  = useState<TimeInfo>(() => getTimeInfo())[0];
    const isMobile  = useIsMobile();

    useEffect(() => {
        const t = setTimeout(() => markReady(), 500);
        return () => clearTimeout(t);
    }, [markReady]);

    useEffect(() => {
        if (!loading && user) navigate("/dashboard", { replace: true });
    }, [user, loading, navigate]);

    const props: LoginPageProps = { season, timeInfo, loading, banned, pendingApproval, authError, signInWithGoogle };

    return isMobile
        ? <LoginPageMobile  {...props} />
        : <LoginPageDesktop {...props} />;
}
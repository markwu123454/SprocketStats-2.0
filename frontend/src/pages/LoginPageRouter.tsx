import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/authContext.tsx";
import { useAppReady } from "@/contexts/appReadyContext.tsx";
import LoginPageDesktop from "./LoginPageDesktop";
import LoginPageMobile from "./LoginPageMobile";

/* ── Theme → season metadata map ────────────────────────────── */
const THEME_SEASONS: Record<string, { year: number; phase: string; label: string; dateRange: string }> = {
    "theme-2025": { year: 2025, phase: "REEFSCAPE", label: "Reefscape",  dateRange: "2025 · DIVE"   },
    "theme-2026": { year: 2026, phase: "REBUILT",   label: "Rebuilt",   dateRange: "2026 · AGE"    },
    "theme-2027": { year: 2027, phase: "BIOCORE",   label: "Biocore",   dateRange: "2027 · CANOPY" },
};

function getActiveTheme(): string {
    for (const key of Object.keys(THEME_SEASONS)) {
        if (document.documentElement.classList.contains(key) || document.body.classList.contains(key)) {
            return key;
        }
    }
    return "theme-2027";
}

/* ── Types ───────────────────────────────────────────────────── */
export interface SeasonInfo {
    phase: string;
    label: string;
    dateRange: string;
    wordmarkUrl: string;
}

export interface TimeInfo {
    weekInfo?: string;
    dateRange: string;
}

export interface LoginPageProps {
    season: SeasonInfo | null;
    timeInfo: TimeInfo;
    loading: boolean;
    banned: boolean;
    signInWithGoogle: () => void;
}

/* ── Helpers ─────────────────────────────────────────────────── */
function getSeasonFromTheme(): SeasonInfo {
    const themeKey = getActiveTheme();
    const meta = THEME_SEASONS[themeKey];
    return {
        phase:       meta.phase,
        label:       meta.label,
        dateRange:   meta.dateRange,
        wordmarkUrl: `/seasons/${meta.year}/wordmark.svg`,
    };
}

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

/* ── Hooks ───────────────────────────────────────────────────── */
function useThemeSeasonInfo(): SeasonInfo | null {
    const [season, setSeason] = useState<SeasonInfo | null>(null);

    useEffect(() => {
        setSeason(getSeasonFromTheme());

        const observer = new MutationObserver(() => setSeason(getSeasonFromTheme()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        observer.observe(document.body,            { attributes: true, attributeFilter: ["class"] });

        return () => observer.disconnect();
    }, []);

    return season;
}

function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener("resize", handler);
        return () => window.removeEventListener("resize", handler);
    }, []);

    return isMobile;
}

/* ── Router ──────────────────────────────────────────────────── */
export default function LoginPageRouter() {
    const { user, loading, banned, signInWithGoogle } = useAuth();
    const navigate  = useNavigate();
    const markReady = useAppReady();
    const season    = useThemeSeasonInfo();
    const timeInfo  = useState<TimeInfo>(() => getTimeInfo())[0];
    const isMobile  = useIsMobile();

    useEffect(() => {
        const t = setTimeout(() => markReady(), 500);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        if (!loading && user) navigate("/dashboard", { replace: true });
    }, [user, loading, navigate]);

    const props: LoginPageProps = { season, timeInfo, loading, banned, signInWithGoogle };

    return isMobile
        ? <LoginPageMobile  {...props} />
        : <LoginPageDesktop {...props} />;
}
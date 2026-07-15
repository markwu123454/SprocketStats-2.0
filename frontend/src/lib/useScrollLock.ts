import { useEffect } from "react"

/** Lock document scroll while a login/onboarding surface is mounted, restoring
 *  the previous overflow/height state on unmount. Shared by both the login and
 *  onboarding pages so the two surfaces behave identically. */
export function useScrollLock() {
    useEffect(() => {
        const html = document.documentElement;
        const body = document.body;
        const prev = {
            htmlOverflow:   html.style.overflow,
            bodyOverflow:   body.style.overflow,
            bodyOverscroll: body.style.overscrollBehavior,
            bodyHeight:     body.style.height,
        };
        html.style.overflow           = "hidden";
        body.style.overflow           = "hidden";
        body.style.overscrollBehavior = "none";
        body.style.height             = "100%";
        return () => {
            html.style.overflow           = prev.htmlOverflow;
            body.style.overflow           = prev.bodyOverflow;
            body.style.overscrollBehavior = prev.bodyOverscroll;
            body.style.height             = prev.bodyHeight;
        };
    }, []);
}

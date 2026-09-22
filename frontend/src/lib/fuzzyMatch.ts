/**
 * Hand-written fuzzy matcher for the roster picker (person dropdowns). No
 * dependencies — matches on display name, ranked by how the query relates to
 * the name rather than plain substring search, so typing "al" surfaces "Al"
 * before "Alexander" and initials like "js" find "John Smith".
 *
 * Match tiers (highest first), base score in parens:
 *   1 (600) exact match
 *   2 (500) text starts with query
 *   3 (400) a word in text starts with query
 *   4 (300) query matches consecutive words' initials ("js" -> "John Smith")
 *   5 (200) text contains query anywhere
 *   6 (100) query is a subsequence of text (chars in order, gaps allowed)
 * A text that satisfies none of these is not a match (`null`).
 *
 * Tiers are checked in that order and the first hit wins, so a word that
 * happens to start with the query (tier 3) is never demoted to the initials
 * or subsequence tiers below it — e.g. "sm" against "John Smith" lands on
 * tier 3 because "Smith" starts with "sm", even though "sm" also reads as a
 * (partial, and here non-matching) initials pattern.
 *
 * Within a tier, a shorter text wins ties: final score subtracts up to 0.99
 * for length, which is always smaller than the 100-point gap between tiers,
 * so the length penalty can never push a match across a tier boundary.
 */

/** Does `q` match the initials of some run of consecutive words in `words`,
 *  one query character per word, in order? The run may start at any word
 *  (not just the first), but must have enough remaining words to cover `q`. */
function matchesInitials(words: string[], q: string): boolean {
    for (let start = 0; start + q.length <= words.length; start++) {
        let ok = true
        for (let i = 0; i < q.length; i++) {
            const word = words[start + i]
            if (!word || word[0] !== q[i]) {
                ok = false
                break
            }
        }
        if (ok) return true
    }
    return false
}

/** Do the characters of `q` appear in `t`, in order, with gaps allowed? */
function isSubsequence(q: string, t: string): boolean {
    let ti = 0
    for (let qi = 0; qi < q.length; qi++) {
        const ch = q[qi]
        let found = false
        while (ti < t.length) {
            ti++
            if (t[ti - 1] === ch) {
                found = true
                break
            }
        }
        if (!found) return false
    }
    return true
}

/** Score `text` against `query`. Higher is better; `null` means no match.
 *  Case-insensitive; `query` is trimmed. A blank query scores every text 0. */
export function fuzzyScore(query: string, text: string): number | null {
    const q = query.trim().toLowerCase()
    if (q === "") return 0

    const t = text.toLowerCase()

    let base: number | null = null
    if (t === q) {
        base = 600
    } else if (t.startsWith(q)) {
        base = 500
    } else {
        const words = t.split(/\s+/).filter(Boolean)
        if (words.some(w => w.startsWith(q))) {
            base = 400
        } else if (matchesInitials(words, q)) {
            base = 300
        } else if (t.includes(q)) {
            base = 200
        } else if (isSubsequence(q, t)) {
            base = 100
        }
    }

    if (base === null) return null
    return base - Math.min(text.length, 99) / 100
}

/** Filter + rank by `label`. A blank query returns `options` unchanged, in
 *  their original order. Otherwise: drop non-matches, sort by score
 *  descending, ties keep their original relative order (stable). */
export function fuzzyFilter<T extends { label: string }>(options: T[], query: string): T[] {
    if (query.trim() === "") return options

    return options
        .map((option, index) => ({ option, index, score: fuzzyScore(query, option.label) }))
        .filter((entry): entry is { option: T; index: number; score: number } => entry.score !== null)
        .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
        .map(entry => entry.option)
}

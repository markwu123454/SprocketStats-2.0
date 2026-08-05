import LegalPageLayout, {type LegalSection} from "@/components/LegalPageLayout"

const CONTACT_EMAIL = "progteam3473@gmail.com"

const sections: LegalSection[] = [
    {
        id: "who-we-are",
        title: "Who we are",
        content: (
            <>
                <p>
                    SprocketStats ("the Service," "the Site," "we," "us") is an internal statistics and tools platform operated by
                    FIRST Robotics Competition Team 3473 ("Team Sprocket", "the Team") for use by its members, mentors, and
                    authorized guests.
                </p>
                <p>
                    SprocketStats is a student-run, non-commercial project. It is <strong>not</strong> affiliated with, endorsed by, or
                    sponsored by <em>FIRST</em>®, FIRST Robotics Competition, The Blue Alliance, Statbotics, or any other third party
                    whose data or trademarks may appear on the Site, with the exception of Human Signal.
                </p>
                <p>
                    Questions about these Terms: <strong><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></strong>
                </p>
            </>
        ),
    },
    {
        id: "acceptance",
        title: "Acceptance",
        content: (
            <>
                <p>
                    By accessing or using SprocketStats, you agree to these Terms of Service and to our{" "}
                    <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use the Service.
                </p>
                <p>
                    If you are under 18, you may use the Service only with the permission of a parent or legal guardian, and only as
                    part of your participation in the Team. By using the Service, you confirm you have that permission.
                </p>
            </>
        ),
    },
    {
        id: "eligibility-and-accounts",
        title: "Eligibility and accounts",
        content: (
            <>
                <p><strong>3.1 Access is by invitation.</strong> Accounts are issued by Team leadership or mentors. The Service is not open to public registration.</p>
                <p><strong>3.2 Your account is yours alone.</strong> Do not share your credentials, log in as another person, or let another person use your session. You are responsible for activity under your account.</p>
                <p><strong>3.3 Accuracy.</strong> Provide accurate information when your account is created and keep it current.</p>
                <p><strong>3.4 Loss of access.</strong> Your access may be suspended or removed at any time, with or without notice, including when you leave the Team, at the end of a season, or for any violation of these Terms.</p>
            </>
        ),
    },
    {
        id: "acceptable-use",
        title: "Acceptable use",
        content: (
            <>
                <p>You agree <strong>not</strong> to:</p>
                <ul>
                    <li>Enter knowingly false, fabricated, or deliberately misleading scouting or match data.</li>
                    <li>Access, scrape, mirror, or bulk-export data you have not been authorized to access.</li>
                    <li>Share Team-internal scouting data, strategy notes, pick lists, or analysis outside the Team without authorization from Team leadership.</li>
                    <li>Attempt to bypass authentication, escalate privileges, probe for vulnerabilities, or interfere with the Service's operation.</li>
                    <li>Use the Service in any way that violates the <em>FIRST</em> Code of Conduct, the principles of Gracious Professionalism®, Diamond Bar High School's acceptable-use policy, or applicable law.</li>
                    <li>Use the Service, or data from it, for any commercial purpose.</li>
                </ul>
                <p>
                    <strong>Reporting security issues.</strong> If you discover a vulnerability, report it to{" "}
                    <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> rather than exploiting or publicizing it. Good-faith reports are welcome.
                </p>
            </>
        ),
    },
    {
        id: "content-and-data",
        title: "Content and data",
        content: (
            <>
                <p><strong>5.1 Your submissions.</strong> You retain whatever rights you have in the scouting entries, notes, images, and other content you submit ("Submissions"). By submitting, you grant the Team a non-exclusive, worldwide, royalty-free license to store, reproduce, modify, display, and use your Submissions for the purposes of operating the Service and supporting the Team's competition, training, outreach, and archival activities.</p>
                <p><strong>5.2 Team data.</strong> Aggregated scouting data, analyses, rankings, pick lists, and other outputs generated on the Service belong to the Team and are treated as internal Team information.</p>
                <p><strong>5.3 The Service itself.</strong> The SprocketStats software, design, and branding are owned by the Team or its contributors and are made available to you under a limited, revocable, non-transferable license to use the Service as intended.</p>
                <p><strong>5.4 Third-party data.</strong> The Service may display or incorporate data from <em>FIRST</em>, The Blue Alliance, Statbotics, or similar sources. That data remains subject to its owners' terms and licenses. We make no claim of ownership over it.</p>
            </>
        ),
    },
    {
        id: "availability",
        title: "Availability",
        content: (
            <p>
                The Service is provided on a best-effort basis by student volunteers. We may change, suspend, limit, or discontinue
                any part of it at any time, including during competition, and we may delete data between seasons. There is no
                guarantee of uptime, data retention, or backup.
            </p>
        ),
    },
    {
        id: "disclaimer-of-warranties",
        title: "Disclaimer of warranties",
        content: (
            <p>
                THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
                WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, AND NON-INFRINGEMENT. To the extent any
                warranty cannot be disclaimed under applicable law, it is limited to the minimum duration permitted.
            </p>
        ),
    },
    {
        id: "limitation-of-liability",
        title: "Limitation of liability",
        content: (
            <>
                <p>
                    TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE TEAM, ITS MEMBERS, MENTORS, PARENT VOLUNTEERS, SPONSORS, AND AFFILIATED
                    SCHOOLS AND ORGANIZATIONS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
                    DAMAGES, OR FOR ANY LOSS OF DATA, COMPETITIVE ADVANTAGE, OR MATCH OUTCOME, ARISING FROM YOUR USE OF THE SERVICE.
                </p>
                <p>Some jurisdictions do not allow certain limitations, so parts of this section may not apply to you.</p>
            </>
        ),
    },
    {
        id: "indemnification",
        title: "Indemnification",
        content: (
            <p>
                You agree to indemnify and hold harmless the Team and the parties listed in Section 8 from any claim arising out of
                your misuse of the Service, your Submissions, or your violation of these Terms or of any law or third-party right.
            </p>
        ),
    },
    {
        id: "changes",
        title: "Changes to these Terms",
        content: (
            <p>
                We may update these Terms. Material changes will be announced through the Service or normal Team communication
                channels, and the "Last updated" date above will change. Continued use after an update means you accept the revised Terms.
            </p>
        ),
    },
    {
        id: "governing-law",
        title: "Governing law",
        content: (
            <p>
                These Terms are governed by the laws of the State of California, without regard to conflict-of-laws rules. Any dispute
                will be brought in the state or federal courts located in Los Angeles, California.
            </p>
        ),
    },
    {
        id: "miscellaneous",
        title: "Miscellaneous",
        content: (
            <p>
                If any provision is found unenforceable, the rest remains in effect. Our failure to enforce a provision is not a waiver
                of it. These Terms, together with the Privacy Policy, are the entire agreement between you and the Team regarding the Service.
            </p>
        ),
    },
    {
        id: "contact",
        title: "Contact",
        content: (
            <>
                <p>
                    FIRST Robotics Competition Team 3473 (Team Sprocket)<br />
                    <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
                </p>
                <p><em><em>FIRST</em>®, FIRST® Robotics Competition, and Gracious Professionalism® are trademarks of the United States Foundation for Inspiration and Recognition of Science and Technology (<em>FIRST</em>®).</em></p>
            </>
        ),
    },
]

export default function TermsPage() {
    return (
        <LegalPageLayout
            activePage="terms"
            eyebrow="Team Sprocket · FRC 3473"
            title="Terms of Service"
            summary="SprocketStats — sprocketstats.com"
            effectiveDate="8/4/2026"
            lastUpdated="8/4/2026"
            contactEmail={CONTACT_EMAIL}
            sections={sections}
        />
    )
}

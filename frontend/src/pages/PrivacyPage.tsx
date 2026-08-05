import LegalPageLayout, {type LegalSection} from "@/components/LegalPageLayout"

const CONTACT_EMAIL = "progteam3473@gmail.com"

const sections: LegalSection[] = [
    {
        id: "summary",
        title: "Summary",
        content: (
            <>
                <p>
                    SprocketStats is a private, invitation-only statistics tool run by FIRST Robotics Competition Team 3473
                    ("Team Sprocket," "the Team," "we," "us") for its members and mentors. We collect the minimum needed to run it.
                </p>
                <ul>
                    <li>We do not sell or rent personal information.</li>
                    <li>We do not run advertising or third-party ad trackers.</li>
                    <li>We do not collect precise location, payment information, or biometric data.</li>
                </ul>
            </>
        ),
    },
    {
        id: "information-we-collect",
        title: "Information we collect",
        content: (
            <>
                <p><strong>2.1 Account information.</strong> When Team leadership creates your account, we store an identifier such as your name or initials, a username, a Team-issued or personal email address, your role (scout, lead, mentor, admin), and a third-party sign-in identifier.</p>
                <p><strong>2.2 Content you submit.</strong> Scouting entries, match observations, notes, pick-list rankings, and any images you upload — along with a timestamp and the account that submitted them.</p>
                <p><strong>2.3 Technical and usage data.</strong> Log data such as IP address, browser and device type, operating system, pages viewed, and time of access. This is used for security, debugging, and load management.</p>
                <p><strong>2.4 Data stored on your device.</strong> SprocketStats is a Progressive Web App. It uses browser storage (IndexedDB, localStorage, cache storage, and session cookies) to keep you signed in, cache the app for offline use, and hold scouting entries locally until they sync. This data lives on your device and is under your control — clearing site data removes it.</p>
                <p><strong>2.5 Third-party competition data.</strong> We import public match and team data from sources such as FIRST, The Blue Alliance, and Statbotics. This is public competition data, not personal information you provide to us.</p>
            </>
        ),
    },
    {
        id: "how-we-use-information",
        title: "How we use information",
        content: (
            <>
                <p>We use the information above only to:</p>
                <ul>
                    <li>Authenticate you and keep your session secure.</li>
                    <li>Store, sync, and display scouting and match data.</li>
                    <li>Generate statistics, rankings, and strategy analysis for the Team.</li>
                    <li>Diagnose bugs, monitor performance, and investigate abuse or unauthorized access.</li>
                    <li>Communicate with you about the Service.</li>
                </ul>
                <p>We do not use your information for advertising, profiling, or automated decision-making that produces legal or similarly significant effects.</p>
            </>
        ),
    },
    {
        id: "legal-bases",
        title: "Legal bases (for users in the EEA/UK, if applicable)",
        content: (
            <p>
                Where the GDPR or UK GDPR applies, we process personal data on the basis of consent (which you may withdraw), our
                legitimate interest in operating a functioning team tool and keeping it secure, and compliance with legal obligations.
            </p>
        ),
    },
    {
        id: "sharing",
        title: "How we share information",
        content: (
            <>
                <p>We share personal information only in these situations:</p>
                <div className="legal-table-wrap">
                    <table>
                        <thead>
                            <tr><th scope="col">Recipient</th><th scope="col">Why</th></tr>
                        </thead>
                        <tbody>
                            <tr><td>Team members and mentors</td><td>Scouting entries are visible to other authorized users, including who submitted them</td></tr>
                            <tr><td>Service providers</td><td>Hosting, database, and authentication vendors — currently NeonDB, Fly.io, and Vercel — who process data on our instructions</td></tr>
                            <tr><td>Diamond Bar High School</td><td>Where required by school or district policy, or as part of Team supervision</td></tr>
                            <tr><td>Legal</td><td>When required by law, subpoena, or to protect the rights and safety of users</td></tr>
                        </tbody>
                    </table>
                </div>
                <p>We do not sell or share personal information for cross-context behavioral advertising, as those terms are defined under the California Consumer Privacy Act.</p>
            </>
        ),
    },
    {
        id: "retention",
        title: "Data retention",
        content: (
            <ul>
                <li><strong>Scouting and match data:</strong> retained for the current season and archived for historical comparison across seasons. Archived data may be retained indefinitely; where practical, we de-identify it first.</li>
                <li><strong>Account records:</strong> retained while you are an active member.</li>
                <li><strong>Server logs:</strong> retained for approximately 30–90 days.</li>
            </ul>
        ),
    },
    {
        id: "students-and-minors",
        title: "Students and minors",
        content: (
            <>
                <p>Most SprocketStats users are between 13 and 18 years old and use the Service as part of a school-affiliated robotics team.</p>
                <p><strong>Under 13.</strong> SprocketStats is not directed to children under 13, and we do not knowingly create accounts for them. If a member under 13 needs access, we require verifiable parental consent before an account is issued, consistent with the Children's Online Privacy Protection Act (COPPA). If we learn we have collected personal information from a child under 13 without that consent, we will delete it promptly.</p>
                <p><strong>13–17.</strong> Accounts are created by Team leadership with parental awareness through the Team's standard registration and consent process. Parents or guardians may contact us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> to review, correct, or request their student's information.</p>
                <p><strong>No advertising or sale.</strong> We do not sell student information, use it for targeted advertising, or build profiles for non-educational purposes.</p>
            </>
        ),
    },
    {
        id: "security",
        title: "Security",
        content: (
            <p>
                We use HTTPS in transit, hashed passwords or delegated third-party authentication, role-based access controls, and
                restricted administrative access. No system is perfectly secure, and SprocketStats is maintained by student volunteers
                — please do not store sensitive personal information in scouting notes. If we become aware of a breach affecting your
                personal information, we will notify affected users and any authorities as required by California law.
            </p>
        ),
    },
    {
        id: "choices-and-rights",
        title: "Your choices and rights",
        content: (
            <>
                <p>You may, at any time:</p>
                <ul>
                    <li>Access the information associated with your account.</li>
                    <li>Correct inaccurate account information.</li>
                    <li>Delete your account and associated personal information, subject to our need to retain aggregate scouting data for Team use (we will de-identify your submissions where deletion is not practical).</li>
                    <li>Clear local data by clearing site data in your browser or uninstalling the PWA.</li>
                    <li>Object or restrict certain processing, and request a copy of your data in a portable format, where those rights apply to you.</li>
                </ul>
                <p>
                    Send requests to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We will respond within 45 days
                    (California) or one month (GDPR/UK GDPR), and we will not discriminate against you for exercising these rights. We
                    may need to verify your identity before acting on a request. Parents and guardians may submit requests on behalf of their student.
                </p>
            </>
        ),
    },
    {
        id: "privacy-signals",
        title: "Do Not Track and Global Privacy Control",
        content: (
            <p>
                We do not track users across third-party sites, so there is nothing for a Do Not Track signal to disable. We honor
                Global Privacy Control signals where applicable.
            </p>
        ),
    },
    {
        id: "international-users",
        title: "International users",
        content: (
            <p>
                The Service is operated in the United States, and information is processed there. If you access it from elsewhere, you
                understand your information will be transferred to and stored in the United States.
            </p>
        ),
    },
    {
        id: "changes",
        title: "Changes to this policy",
        content: (
            <p>
                We may update this policy. Material changes will be announced through the Service or normal Team communication
                channels, and the "Last updated" date above will change.
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
                <p><em>FIRST® and FIRST® Robotics Competition are trademarks of the United States Foundation for Inspiration and Recognition of Science and Technology (FIRST®). SprocketStats is not affiliated with or endorsed by FIRST.</em></p>
            </>
        ),
    },
]

export default function PrivacyPage() {
    return (
        <LegalPageLayout
            activePage="privacy"
            eyebrow="Team Sprocket · FRC 3473"
            title="Privacy Policy"
            summary="SprocketStats — sprocketstats.com"
            effectiveDate="8/4/2026"
            lastUpdated="8/4/2026"
            contactEmail={CONTACT_EMAIL}
            sections={sections}
        />
    )
}

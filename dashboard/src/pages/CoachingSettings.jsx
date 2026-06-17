import { Link } from "react-router-dom";
import { getUser } from "../api";
import WalkthroughEditor from "../components/CallCoach/WalkthroughEditor";
import CueEmphasisEditor from "../components/CallCoach/CueEmphasisEditor";
import DimensionsEditor from "../components/CallCoach/DimensionsEditor";

export default function CoachingSettings() {
  const isManager = ["owner", "admin"].includes(getUser()?.role);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link to="/call-coach" className="text-sm text-brand-600 hover:underline">
          ← AI Coaching
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Coaching settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tailor the in-home walkthrough, live coaching cues, and scoring
          dimensions to your trade. Changes apply to sessions and scores after
          you save.
        </p>
      </div>

      {!isManager ? (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          Only an owner or admin can edit coaching settings.
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Walkthrough stages
            </h2>
            <WalkthroughEditor />
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Live cue emphasis
            </h2>
            <CueEmphasisEditor />
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Scorecard dimensions
            </h2>
            <DimensionsEditor />
          </section>
        </div>
      )}
    </div>
  );
}

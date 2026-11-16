import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui";
import { SearchIcon } from "../components/Icons";

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<SearchIcon size={18} />}
      title="Page not found"
      actions={
        <>
          <Link className="button button--primary" to="/">
            Back to feed
          </Link>
          <Link className="button" to="/programs">
            Browse programs
          </Link>
        </>
      }
    >
      That route does not exist. The feed, programs, watchlist and admin pages are the whole
      app.
    </EmptyState>
  );
}

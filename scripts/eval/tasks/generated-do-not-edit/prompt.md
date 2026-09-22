`matchRoute('/orgs/acme/repos/site')` returns `null`, even though `/orgs/:org/repos/:repo` is listed in `routes.json`. Routes with a single parameter work. Fix it.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Quickstart from "./Quickstart";

test("renders the three installation steps", () => {
  const view = renderToStaticMarkup(<Quickstart />);

  expect(view).toContain("bun add -g @hermenics/deepseek-code");
  expect(view).toContain("data-testid=\"copy-install\"");
  expect(view).toContain("data-testid=\"copy-configure\"");
  expect(view).toContain("data-testid=\"copy-start\"");
});

import React from "react";
import type { DevFixtureMode } from "../../types/internal";

export function FixtureBanner({ mode }: { mode: DevFixtureMode }) {
  return <div className="fixture-banner">Fixture mode: {mode}</div>;
}

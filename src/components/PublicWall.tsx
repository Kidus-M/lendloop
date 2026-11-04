"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { EmptyWall, ToolWall } from "./ToolWall";

export function PublicWall() {
  const tools = useQuery(api.tools.listPublic);

  if (tools === undefined) {
    return <p className="text-ink-soft">Checking the wall.</p>;
  }

  if (tools.length === 0) {
    return (
      <EmptyWall>
        <p className="font-bold">Nothing is hanging here yet.</p>
        <p>Sign in and hang up the first tool for your neighbors.</p>
      </EmptyWall>
    );
  }

  return <ToolWall tools={tools} />;
}

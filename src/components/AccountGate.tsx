"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";

type Me = FunctionReturnType<typeof api.users.me>;

const MeContext = createContext<Me | null>(null);

/** The current account. Only for display: Convex enforces every permission itself. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe must be used inside AccountGate.");
  return me;
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="mx-auto max-w-6xl px-4 py-16 sm:px-8">{children}</p>;
}

/** Makes sure the Convex user row exists before anything queries it. */
export function AccountGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    ensureCurrent({})
      .then(() => active && setReady(true))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [isAuthenticated, ensureCurrent]);

  if (failed || (!isLoading && !isAuthenticated)) {
    return <Notice>Your sign-in didn&rsquo;t reach LendLoop. Refresh the page to try again.</Notice>;
  }
  if (!ready) return <Notice>Opening your account.</Notice>;

  return <LoadedAccount>{children}</LoadedAccount>;
}

function LoadedAccount({ children }: { children: ReactNode }) {
  const me = useQuery(api.users.me);
  if (!me) return <Notice>Opening your account.</Notice>;
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

import { Show, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { PublicWall } from "@/components/PublicWall";

export default function HomePage() {
  return (
    <div className="pegboard min-h-dvh">
      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
        <header className="pt-10 pb-14 sm:pt-16 sm:pb-20">
          <p className="font-display text-3xl font-black">LendLoop</p>
          <h1 className="mt-6 max-w-4xl font-stencil text-6xl font-black leading-[0.95] sm:text-8xl lg:text-[8.5rem]">
            Borrow what you need. Lend what you don&rsquo;t.
          </h1>
          <p className="mt-6 max-w-xl text-xl">
            A shared tool wall for your neighborhood. Everything hanging below is free to
            borrow right now.
          </p>
          <div className="mt-8">
            <Show
              when="signed-in"
              fallback={
                <SignInButton mode="modal" forceRedirectUrl="/board">
                  <button type="button" className="btn btn-primary text-lg">
                    Sign in to lend or borrow
                  </button>
                </SignInButton>
              }
            >
              <Link href="/board" className="btn btn-primary text-lg">
                Go to the tool wall
              </Link>
            </Show>
          </div>
        </header>

        <section aria-labelledby="wall-heading">
          <h2 id="wall-heading" className="mb-8 text-4xl">
            On the wall today
          </h2>
          <PublicWall />
        </section>
      </main>
    </div>
  );
}

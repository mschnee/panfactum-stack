import { IoCloseCircleSharp } from "solid-icons/io";
import { type Component, createSignal, Match, onMount, Switch } from "solid-js";

import "@/styles/base.css";

/**************************************************
 * The banner implementation is a little complicated b/c it impacts the overall height
 * of the document which has a huge impact on layout properties all over the site.
 *
 * To make this work with the least amount of UI jank, I've settled on the following implementation:
 * - The banner is exactly 4rem tall (does not dynamically adjust).
 * - Having the banner open doubles the --header-height CSS variable which all components requiring page
 * height calculations use.
 * - This is done by adding / removing the 'data-banner' attribute from the html DOM node which impacts the
 * CSS selectors defined in '@/styles/variables.css' and '@/styles/base.css'
 * - The banner is always visible on first page load and then automatically closes if the user has previously
 * closed it. This ensures that it is always shipped in the HTML sent to search engines at the cost of some
 * minor visual jank on page refresh for real users who have previously disabled the banner. I do not believe that this is avoidable if the site is to
 * be statically pre-rendered.
 * ***********************************************/

// Change this key if you want to force re-enable the banner for users
const KEY = "banner-open-126";

const HeaderBanner: Component = () => {
  const [pathname, setPathname] = createSignal("");

  const closeBanner = () => {
    window.document
      .getElementsByTagName("html")[0]
      .toggleAttribute("data-banner", false);
    window.localStorage.setItem(KEY, "false");
  };

  onMount(() => {
    if (window.localStorage.getItem(KEY) === "false") {
      closeBanner();
    }
    setPathname(new URL(window.location.href).pathname);

    // Update pathname when navigation occurs
    document.addEventListener("astro:page-load", () => {
      setPathname(new URL(window.location.href).pathname);
    });
  });

  return (
    <Switch>
      <Match when={pathname() === "/"}>
        <div
          class={`
            grow basis-1 items-center justify-between gap-6 bg-accent px-6
            lg:justify-center
          `}
        >
          <span
            class={`
              text-sm
              md:text-base
              lg:text-lg
            `}
          >
            <span
              class={`
                hidden
                md:inline
              `}
            >
              Want Panfactum without the hassle?
            </span>{" "}
            <a href="/plus" class="cursor-pointer underline underline-offset-4">
              Try PanfactumPlus
            </a>
          </span>
        </div>
      </Match>
      <Match when={pathname() !== "/"}>
        <div
          class={`
            grow basis-1 items-center justify-between gap-6 bg-accent px-6
            lg:justify-center
          `}
        >
          <span
            class={`
              text-sm
              md:text-base
              lg:text-lg
            `}
          >
            <span
              class={`
                hidden
                md:inline
              `}
            >
              Know someone who would benefit from Panfactum?{" "}
            </span>
            Earn <b>$10,000</b> per referral
            <span
              class={`
                inline
                md:hidden
              `}
            >
              {" "}
              to our support plans
            </span>
            .{" "}
            <a
              href="/referrals"
              class="cursor-pointer underline underline-offset-4"
            >
              Learn more.
            </a>
          </span>
          <button
            onClick={() => {
              closeBanner();
            }}
            class={`
              flex justify-center
              lg:absolute lg:right-12
            `}
          >
            <IoCloseCircleSharp size={30} />
          </button>
        </div>
      </Match>
    </Switch>
  );
};

export default HeaderBanner;

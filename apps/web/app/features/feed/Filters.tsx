// Feed filters: the channel and category choice (a row of tabs on desktop, a sheet behind the bar's filter
// button on phones), the phone bar of 精选 and 全部, and search.
import { useEffect, useRef, useState } from "react";
import { Form, Link, useLocation, useNavigate, useNavigation, useSearchParams } from "react-router";
import { CATEGORY_KEYS, CATEGORY_LABELS, CHANNEL_LABELS, COLLEGES, COLLEGE_LABELS, type CategoryKey, type ChannelKey, type CollegeKey } from "@aihot/contracts/taxonomy";
import { TOPIC_TAGS } from "@aihot/industry/taxonomy";
import { SITE } from "@aihot/site";
import { IconClose, IconFilter, IconSearch } from "../../components/icons";
import { PillTabs } from "../../components/ui/Tabs";
import { ChoiceTick, Sheet, sheetChoice } from "../../components/ui/Sheet";
import { Select } from "../../components/ui/Controls";
import { readFilters } from "../../lib/seo";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import { BarButton, PhoneBar } from "../../components/shell/PhoneBar";
import { openSearch } from "../search/SearchOverlay";

/** Same page with some query parameters changed (paging state dropped). */
function hrefWith(base: string, params: URLSearchParams, patch: Record<string, string | null>) {
  const sp = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  sp.delete("page");
  sp.delete("cursor");
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * The feed's one filter (精选 and 全部动态 alike): none, 一手, or a category. One choice at a time: picking
 * 一手 clears the category and picking a category clears 一手. Older 资讯 / X links still filter; the
 * choice then shows as none.
 */
function filterOptions(base: string, params: URLSearchParams, noneLabel: string) {
  return [
    { key: "all", label: noneLabel, to: hrefWith(base, params, { category: null, channel: null, q: null, search: null, tab: null }) },
    { key: "firstParty", label: CHANNEL_LABELS.firstParty, to: hrefWith(base, params, { category: null, channel: "firstParty", q: null, search: null, tab: null }) },
    ...CATEGORY_KEYS.map((k) => ({ key: k, label: CATEGORY_LABELS[k], to: hrefWith(base, params, { category: k, channel: null, q: null, search: null, tab: null }) })),
  ];
}

function filterKey(category: CategoryKey | null, channel: ChannelKey): string {
  return channel === "firstParty" ? "firstParty" : (category ?? "all");
}

/** Desktop: the filter as a row of tabs beside the search field. */
export function CategoryTabs({ base, category, channel = "all", layoutId, className = "" }: { base: string; category: CategoryKey | null; channel?: ChannelKey; layoutId: string; className?: string }) {
  const [params] = useSearchParams();
  return <PillTabs items={filterOptions(base, params, "全部").map(o => ({ ...o, prefetchOnPress: true }))} active={filterKey(category, channel)} layoutId={layoutId} label="筛选" className={className} />;
}

/** Publishing college is independent of category, audience and channel. */
export function CollegeSelect({ base, college, hint = false, onChange }: { base: string; college: CollegeKey | null; hint?: boolean; onChange?: () => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  return (
    <div className="min-w-0 max-w-full">
      <label className="flex min-w-0 max-w-full flex-col gap-2 lg:flex-row lg:items-center">
        <span className="shrink-0 text-[13px] font-semibold text-ink-3">发布学院</span>
        <Select
          aria-label="发布学院"
          aria-describedby={hint ? "college-filter-hint" : undefined}
          value={college ?? ""}
          className="min-w-0 max-w-full lg:w-72 [&_select]:min-w-0 [&_select]:truncate"
          onChange={(event) => {
            void navigate(hrefWith(base, params, { college: event.currentTarget.value || null }));
            onChange?.();
          }}
        >
          <option value="">全部单位（含校级）</option>
          {COLLEGES.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
        </Select>
      </label>
      {hint && <p id="college-filter-hint" className="mt-2 text-[12px] leading-relaxed text-ink-4">按发文学院归属筛选，可叠加事项与受众；通知是否限本院请以正文为准。</p>}
    </div>
  );
}

/**
 * The phone bar of 精选 and 全部: the brand, the 精选 | 全部 switch (a filter in use carries over), and
 * buttons for the filter sheet and search.
 */
export function FeedBar({ base, category, channel, college }: { base: "/" | "/all"; category: CategoryKey | null; channel: ChannelKey; college: CollegeKey | null }) {
  const [params] = useSearchParams();
  const [sheet, setSheet] = useState(false);
  const scope = (to: string) => hrefWith(to, params, { search: null });
  const filtered = filterKey(category, channel) !== "all" || !!college || !!params.get("tag")?.trim();
  return (
    <>
      <PhoneBar
        leading={
          <Link to="/" aria-label={`${SITE.name} 首页`} className="flex h-11 items-center pl-2.5 pr-2 text-ink">
            <Wordmark size={17} />
          </Link>
        }
        center={
          <PillTabs
            size="sm"
            layoutId="feed-scope"
            label="看精选或全部"
            active={base === "/" ? "featured" : "all"}
            items={[
              { key: "featured", label: "精选", to: scope("/"), resetScroll: true, prefetchOnPress: true },
              { key: "all", label: "全部", to: scope("/all"), resetScroll: true, prefetchOnPress: true },
            ]}
          />
        }
        actions={
          <>
            <BarButton label={filtered ? "筛选（已选）" : "筛选"} on={filtered} onClick={() => setSheet(true)}>
              <IconFilter size={21} />
              {filtered && <span aria-hidden="true" className="absolute right-[9px] top-[9px] size-[7px] rounded-full bg-accent ring-2 ring-bg" />}
            </BarButton>
            <SearchButton />
          </>
        }
      />
      <FilterSheet open={sheet} onClose={() => setSheet(false)} base={base} active={filterKey(category, channel)} />
    </>
  );
}

/** Phones: the filter as a sheet of options, the one in use ticked; choosing one applies it. */
function FilterSheet({ open, onClose, base, active }: { open: boolean; onClose: () => void; base: string; active: string }) {
  const [params] = useSearchParams();
  const tag = params.get("tag")?.trim() || null;
  const audience = TOPIC_TAGS.find((t) => t === tag) ?? null;
  return (
    <Sheet open={open} onClose={onClose} title="筛选">
      <section className="mx-4 mb-5 min-w-0">
        <CollegeSelect base={base} college={readFilters(params).college} hint onChange={onClose} />
      </section>
      <ul className="mx-4 divide-y divide-line-soft">
        {filterOptions(base, params, "不限").map((o) => {
          const on = o.key === active;
          return (
            <li key={o.key}>
              <Link
                to={o.to}
                onClick={onClose}
                aria-current={on ? "true" : undefined}
                className={`-mx-2 rounded-tile px-2 ${sheetChoice(on)}`}
              >
                {o.label}
                {on && <ChoiceTick />}
              </Link>
            </li>
          );
        })}
      </ul>
      <section className="mx-4 mt-5" aria-labelledby="audience-filter-label">
        <h2 id="audience-filter-label" className="px-2 text-[13px] font-semibold text-ink-3">面向受众</h2>
        <ul className="mt-2 divide-y divide-line-soft">
          {[null, ...TOPIC_TAGS].map((t) => {
            const on = t === audience;
            return (
              <li key={t ?? "all"}>
                <Link
                  to={hrefWith(base, params, { tag: t === null ? (audience ? null : tag) : on ? null : t })}
                  onClick={onClose}
                  aria-current={on ? "true" : undefined}
                  className={`-mx-2 rounded-tile px-2 ${sheetChoice(on)}`}
                >
                  {t ?? "不限受众"}
                  {on && <ChoiceTick />}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </Sheet>
  );
}

/** Phones: the filter and tag in use as chips under the bar; each one clears itself when tapped. */
export function ActiveFilters({ base, category, channel, college, tag }: { base: string; category: CategoryKey | null; channel: ChannelKey; college: CollegeKey | null; tag: string | null }) {
  const [params] = useSearchParams();
  const label = channel === "firstParty" ? CHANNEL_LABELS.firstParty : category ? CATEGORY_LABELS[category] : null;
  const audience = TOPIC_TAGS.some((t) => t === tag);
  if (!label && !college && !tag) return null;
  const chip = "inline-flex min-h-11 max-w-full items-center gap-1 rounded-full bg-accent-soft pl-3 pr-2 text-[13px] font-medium text-accent transition-opacity active:opacity-60";
  return (
    <div className="flex flex-wrap gap-2 pb-3 pt-1 lg:hidden">
      {label && (
        <Link to={hrefWith(base, params, { category: null, channel: null })} aria-label={`取消筛选：${label}`} className={chip}>
          <span className="truncate">只看{label}</span>
          <IconClose size={14} strokeWidth={2} className="shrink-0" />
        </Link>
      )}
      {college && (
        <Link to={hrefWith(base, params, { college: null })} aria-label={`取消发布学院筛选：${COLLEGE_LABELS[college]}`} className={chip}>
          <span className="truncate">发自{COLLEGE_LABELS[college]}</span>
          <IconClose size={14} strokeWidth={2} className="shrink-0" />
        </Link>
      )}
      {tag && (
        <Link to={hrefWith(base, params, { tag: null })} aria-label={audience ? `取消受众：${tag}` : `取消标签：${tag}`} className={chip}>
          <span className="truncate">{audience ? `只看${tag}` : `#${tag}`}</span>
          <IconClose size={14} strokeWidth={2} className="shrink-0" />
        </Link>
      )}
    </div>
  );
}

/** Phones: the magnifier in a bar; the search opens over the page with the keyboard up. */
function SearchButton() {
  return (
    <BarButton label="搜索" onClick={(event) => openSearch("", event.currentTarget)}>
      <IconSearch size={21} />
    </BarButton>
  );
}

function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

/** Desktop search field (GET /all?q=…): at the end of the filter row as the same grey track, at the height of md tabs, with a "/" hint. */
export function SearchField({ defaultValue = "", keep = {} }: { defaultValue?: string; keep?: Record<string, string | null> }) {
  const [params] = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(defaultValue), [defaultValue]);
  useSlashFocus(inputRef);
  const searching = navigation.state === "loading" && navigation.location?.pathname === "/all" && !!new URLSearchParams(navigation.location.search).get("q");
  const hidden = Object.entries({
    ...Object.fromEntries(["category", "channel", "college", "tag", "tab"].map((k) => [k, params.get(k)])),
    ...keep,
  }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null));
  const clearSearch = () => {
    setValue("");
    if (params.get("q")) {
      navigate(hrefWith(location.pathname || "/all", params, { q: null, search: null, tab: null }));
    } else {
      inputRef.current?.focus();
    }
  };


  return (
    <Form
      method="get"
      action="/all"
      role="search"
      className="group relative w-full shrink-0 lg:w-60"
      onSubmit={(e) => {
        if (!value.trim()) {
          e.preventDefault();
          clearSearch();
        }
      }}
    >
      {hidden}
      <label htmlFor="site-search" className="sr-only">
        搜索全站动态（标题、来源、摘要及正文）
      </label>
      <IconSearch size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${searching ? "text-accent" : "text-ink-4 group-focus-within:text-ink-3"}`} />
      <input
        ref={inputRef}
        id="site-search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (params.get("q") && !value.trim()) {
            clearSearch();
          }
        }}
        placeholder="搜索标题、来源、摘要…"
        maxLength={200}
        autoComplete="off"
        className="h-[42px] w-full rounded-full bg-well pl-10 pr-10 text-[14px] text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent"
      />
      {value ? (
        <button
          type="button"
          aria-label="清空"
          onClick={clearSearch}
          className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink"
        >
          <IconClose size={13} />
        </button>
      ) : (
        <kbd className="mono pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-mark border border-line-strong bg-surface px-1.5 text-[10.5px] leading-4 text-ink-4 lg:block">/</kbd>
      )}
    </Form>
  );
}

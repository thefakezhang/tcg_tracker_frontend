import dynamic from "next/dynamic";
import ViewLoading from "./ViewLoading";
import { useEffect, useRef, type ReactNode } from "react";
import {
  Boxes, CalendarDays, ClipboardCheck, DollarSign, Filter, Landmark, Library, PackageOpen,
  ArrowLeftRight, HandCoins, Languages, Map as MapIcon, Receipt, ScanLine, ScanSearch, Send, ShieldCheck, ShoppingBasket, Store, Users, Activity, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { MATCH_REVIEW_SENTINEL, useReviewQueueNavigation } from "./ReviewQueueNavigationContext";

const TripsOverview = dynamic(() => import("./TripsOverview"), { loading: ViewLoading });
const InventoryView = dynamic(() => import("./InventoryView"), { loading: ViewLoading });
const ScanReviewView = dynamic(() => import("./ScanReviewView"), { loading: ViewLoading });
const SalesView = dynamic(() => import("./SalesView"), { loading: ViewLoading });
const TradesView = dynamic(() => import("./TradesView"), { loading: ViewLoading });
const CurationView = dynamic(() => import("./CurationView"), { loading: ViewLoading });
const SealedCurationView = dynamic(() => import("./SealedCurationView"), { loading: ViewLoading });
const CardIndexView = dynamic(() => import("./CardIndexView"), { loading: ViewLoading });
const MatchReviewView = dynamic(() => import("./MatchReviewView"), { loading: ViewLoading });
const SourceHealthView = dynamic(() => import("./SourceHealthView"), { loading: ViewLoading });
const EventsCalendarView = dynamic(() => import("./EventsCalendarView"), { loading: ViewLoading });
const ImageAutoAcceptView = dynamic(() => import("./ImageAutoAcceptView"), { loading: ViewLoading });
const CustomersView = dynamic(() => import("./CustomersView"), { loading: ViewLoading });
const ReachOutView = dynamic(() => import("./ReachOutView"), { loading: ViewLoading });
const ShoppingListView = dynamic(() => import("./ShoppingListView"), { loading: ViewLoading });
const PurchasePlannerView = dynamic(() => import("./PurchasePlannerView"), { loading: ViewLoading });
const FinancesView = dynamic(() => import("./FinancesView"), { loading: ViewLoading });
const ExpensesTab = dynamic(() => import("./trip/ExpensesTab"), { loading: ViewLoading });
const EnglishCounterpartReviewView = dynamic(() => import("./EnglishCounterpartReviewView"), { loading: ViewLoading });
const EnglishCatalogReviewView = dynamic(() => import("./EnglishCatalogReviewView"), { loading: ViewLoading });
const ArrivalPostsView = dynamic(() => import("./ArrivalPostsView"), { loading: ViewLoading });
const TwitterBuybacksView = dynamic(() => import("./TwitterBuybacksView"), { loading: ViewLoading });
const MercariTab = dynamic(() => import("./MercariTab"), { loading: ViewLoading });

function RoutedMatchReviewView() {
  const { target, consumeTarget } = useReviewQueueNavigation();
  // Capture once. Clearing the context must not clear the props on this mounted
  // queue, but it must make the next ordinary sidebar visit unfiltered.
  const initialTarget = useRef(target);
  useEffect(() => {
    if (initialTarget.current) consumeTarget();
  }, [consumeTarget]);
  return (
    <MatchReviewView
      initialGame={initialTarget.current?.game}
      initialSource={initialTarget.current?.source}
    />
  );
}

// Single source of truth for the top-level dashboard views. Previously the
// sentinel-number -> view mapping was hand-duplicated across page.tsx (which
// component), DashboardShell.tsx (header title) and AppSidebar.tsx (nav button);
// they now all derive from this list. `sentinel` is the value carried by
// TripContext.activeTripId (0 = trips overview, negatives = standalone views,
// positives = a real trip). `group` matches the sidebar SidebarGroupLabel key.
export interface ViewDef {
  sentinel: number;
  slug: string;               // stable URL token: /dashboard?view=<slug>
  group: TranslationKey;
  icon: LucideIcon;
  sidebarKey: TranslationKey; // label in the sidebar
  titleKey: TranslationKey;   // title in the header (often the same)
  render: () => ReactNode;
}

export const VIEWS: ViewDef[] = [
  { sentinel: -3, slug: "curation", group: "curation.title", icon: ScanSearch, sidebarKey: "curation.needsReview", titleKey: "curation.title", render: () => <CurationView key="curation" /> },
  { sentinel: -9, slug: "sealed-curation", group: "curation.title", icon: ScanSearch, sidebarKey: "curation.titleSealed", titleKey: "curation.titleSealed", render: () => <SealedCurationView key="sealed-curation" /> },
  { sentinel: -5, slug: "index", group: "catalog.section", icon: Library, sidebarKey: "catalog.index", titleKey: "catalog.index", render: () => <CardIndexView key="card-index" /> },
  { sentinel: MATCH_REVIEW_SENTINEL, slug: "review", group: "catalog.section", icon: ClipboardCheck, sidebarKey: "review.title", titleKey: "review.title", render: () => <RoutedMatchReviewView key="match-review" /> },
  { sentinel: -17, slug: "counterparts", group: "catalog.section", icon: Languages, sidebarKey: "counterpart.queueNav", titleKey: "counterpart.queueTitle", render: () => <EnglishCounterpartReviewView key="counterpart-review" /> },
  { sentinel: -18, slug: "english-catalog", group: "catalog.section", icon: Library, sidebarKey: "englishCatalog.nav", titleKey: "englishCatalog.title", render: () => <EnglishCatalogReviewView key="english-catalog-review" /> },
  { sentinel: -12, slug: "health", group: "catalog.section", icon: Activity, sidebarKey: "sidebar.sourceHealth", titleKey: "health.title", render: () => <SourceHealthView key="source-health" /> },
  { sentinel: -13, slug: "events", group: "catalog.section", icon: CalendarDays, sidebarKey: "events.title", titleKey: "events.title", render: () => <EventsCalendarView key="events-calendar" /> },
  { sentinel: -21, slug: "arrivals", group: "catalog.section", icon: PackageOpen, sidebarKey: "arrivals.nav", titleKey: "arrivals.title", render: () => <ArrivalPostsView key="arrival-posts" /> },
  { sentinel: -23, slug: "buybacks", group: "catalog.section", icon: HandCoins, sidebarKey: "buybacks.nav", titleKey: "buybacks.title", render: () => <TwitterBuybacksView key="twitter-buybacks" /> },
  { sentinel: -22, slug: "mercari", group: "catalog.section", icon: Store, sidebarKey: "mercari.nav", titleKey: "mercari.tabTitle", render: () => <MercariTab key="mercari" /> },
  // Lives with the curation surfaces: it governs what the image-curation
  // pipeline auto-promotes, so the operator looks for it next to the queues.
  { sentinel: -15, slug: "auto-accept", group: "curation.title", icon: ShieldCheck, sidebarKey: "autoAccept.title", titleKey: "autoAccept.title", render: () => <ImageAutoAcceptView key="image-autoaccept" /> },
  { sentinel: -7, slug: "customers", group: "customers.section", icon: Users, sidebarKey: "customers.title", titleKey: "customers.title", render: () => <CustomersView key="customers" /> },
  { sentinel: -8, slug: "reachout", group: "customers.section", icon: Send, sidebarKey: "reachout.title", titleKey: "reachout.title", render: () => <ReachOutView key="reachout" /> },
  { sentinel: -10, slug: "shopping-list", group: "customers.section", icon: Filter, sidebarKey: "shoppingList.title", titleKey: "shoppingList.title", render: () => <ShoppingListView key="shopping-list" /> },
  { sentinel: -14, slug: "planner", group: "customers.section", icon: ShoppingBasket, sidebarKey: "purchasePlanner.title", titleKey: "purchasePlanner.title", render: () => <PurchasePlannerView key="purchase-planner" /> },
  { sentinel: 0, slug: "trips", group: "sidebar.trips", icon: MapIcon, sidebarKey: "trips.overviewTitle", titleKey: "trips.overviewTitle", render: () => <TripsOverview key="trips-overview" /> },
  { sentinel: -1, slug: "inventory", group: "sidebar.trips", icon: Boxes, sidebarKey: "inventory.title", titleKey: "inventory.title", render: () => <InventoryView key="inventory" /> },
  { sentinel: -19, slug: "scan-review", group: "sidebar.trips", icon: ScanLine, sidebarKey: "scanReview.nav", titleKey: "scanReview.title", render: () => <ScanReviewView key="scan-review" /> },
  { sentinel: -2, slug: "sales", group: "sidebar.trips", icon: DollarSign, sidebarKey: "sales.allTitle", titleKey: "sales.allTitle", render: () => <SalesView key="sales" /> },
  { sentinel: -20, slug: "trades", group: "sidebar.trips", icon: ArrowLeftRight, sidebarKey: "trades.nav", titleKey: "trades.title", render: () => <TradesView key="trades" /> },
  { sentinel: -4, slug: "expenses", group: "sidebar.trips", icon: Receipt, sidebarKey: "expenses.title", titleKey: "expenses.title", render: () => <div key="expenses" className="p-4"><ExpensesTab tripId={null} /></div> },
  { sentinel: -11, slug: "finances", group: "sidebar.trips", icon: Landmark, sidebarKey: "finances.title", titleKey: "finances.title", render: () => <FinancesView key="finances" /> },
];

export const viewBySentinel = new Map(VIEWS.map((v) => [v.sentinel, v]));
export const viewBySlug = new Map(VIEWS.map((v) => [v.slug, v]));

// Sidebar groups in render order, with their SidebarGroupLabel key.
export const VIEW_GROUPS: TranslationKey[] = ["curation.title", "catalog.section", "customers.section", "sidebar.trips"];

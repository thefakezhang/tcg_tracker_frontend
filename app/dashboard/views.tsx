import { useEffect, useRef, type ReactNode } from "react";
import {
  Boxes, CalendarDays, ClipboardCheck, DollarSign, Filter, Landmark, Library,
  Languages, Map as MapIcon, Receipt, ScanSearch, Send, ShieldCheck, ShoppingBasket, Users, Activity, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import TripsOverview from "./TripsOverview";
import InventoryView from "./InventoryView";
import SalesView from "./SalesView";
import CurationView from "./CurationView";
import ScannerReviewView from "./ScannerReviewView";
import SealedCurationView from "./SealedCurationView";
import CardIndexView from "./CardIndexView";
import MatchReviewView from "./MatchReviewView";
import SourceHealthView from "./SourceHealthView";
import EventsCalendarView from "./EventsCalendarView";
import ImageAutoAcceptView from "./ImageAutoAcceptView";
import CustomersView from "./CustomersView";
import ReachOutView from "./ReachOutView";
import ShoppingListView from "./ShoppingListView";
import PurchasePlannerView from "./PurchasePlannerView";
import FinancesView from "./FinancesView";
import ExpensesTab from "./trip/ExpensesTab";
import EnglishCounterpartReviewView from "./EnglishCounterpartReviewView";
import EnglishCatalogReviewView from "./EnglishCatalogReviewView";
import { MATCH_REVIEW_SENTINEL, useReviewQueueNavigation } from "./ReviewQueueNavigationContext";

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
  // Lives with the curation surfaces: it governs what the image-curation
  // pipeline auto-promotes, so the operator looks for it next to the queues.
  // Sits with the curation surfaces because it is the same act: a person
  // confirming what a recognizer proposed, before it becomes durable.
  { sentinel: -19, slug: "scanner-review", group: "curation.title", icon: ScanSearch, sidebarKey: "scanner.nav", titleKey: "scanner.title", render: () => <ScannerReviewView key="scanner-review" /> },
  { sentinel: -15, slug: "auto-accept", group: "curation.title", icon: ShieldCheck, sidebarKey: "autoAccept.title", titleKey: "autoAccept.title", render: () => <ImageAutoAcceptView key="image-autoaccept" /> },
  { sentinel: -7, slug: "customers", group: "customers.section", icon: Users, sidebarKey: "customers.title", titleKey: "customers.title", render: () => <CustomersView key="customers" /> },
  { sentinel: -8, slug: "reachout", group: "customers.section", icon: Send, sidebarKey: "reachout.title", titleKey: "reachout.title", render: () => <ReachOutView key="reachout" /> },
  { sentinel: -10, slug: "shopping-list", group: "customers.section", icon: Filter, sidebarKey: "shoppingList.title", titleKey: "shoppingList.title", render: () => <ShoppingListView key="shopping-list" /> },
  { sentinel: -14, slug: "planner", group: "customers.section", icon: ShoppingBasket, sidebarKey: "purchasePlanner.title", titleKey: "purchasePlanner.title", render: () => <PurchasePlannerView key="purchase-planner" /> },
  { sentinel: 0, slug: "trips", group: "sidebar.trips", icon: MapIcon, sidebarKey: "trips.overviewTitle", titleKey: "trips.overviewTitle", render: () => <TripsOverview key="trips-overview" /> },
  { sentinel: -1, slug: "inventory", group: "sidebar.trips", icon: Boxes, sidebarKey: "inventory.title", titleKey: "inventory.title", render: () => <InventoryView key="inventory" /> },
  { sentinel: -2, slug: "sales", group: "sidebar.trips", icon: DollarSign, sidebarKey: "sales.allTitle", titleKey: "sales.allTitle", render: () => <SalesView key="sales" /> },
  { sentinel: -4, slug: "expenses", group: "sidebar.trips", icon: Receipt, sidebarKey: "expenses.title", titleKey: "expenses.title", render: () => <div key="expenses" className="p-4"><ExpensesTab tripId={null} /></div> },
  { sentinel: -11, slug: "finances", group: "sidebar.trips", icon: Landmark, sidebarKey: "finances.title", titleKey: "finances.title", render: () => <FinancesView key="finances" /> },
];

export const viewBySentinel = new Map(VIEWS.map((v) => [v.sentinel, v]));
export const viewBySlug = new Map(VIEWS.map((v) => [v.slug, v]));

// Sidebar groups in render order, with their SidebarGroupLabel key.
export const VIEW_GROUPS: TranslationKey[] = ["curation.title", "catalog.section", "customers.section", "sidebar.trips"];

"use client";

import { useEffect, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/lib/i18n";
import MercariDealsView, { type MercariDealActor, type MercariDealsLoader } from "./MercariDealsView";
import MercariLeadsView, { type MercariLeadActor, type MercariLeadsLoader } from "./MercariLeadsView";
import {
  DEFAULT_MERCARI_FEED,
  MERCARI_FEED_PARAM,
  parseMercariFeedParam,
  readUrlParam,
  writeUrlParam,
  type MercariFeed,
} from "./url-params";

function readFeed(): MercariFeed {
  return parseMercariFeedParam(readUrlParam(MERCARI_FEED_PARAM)) ?? DEFAULT_MERCARI_FEED;
}

// The Mercari view (slug `mercari`) holds two feeds behind one switch:
// Leads, the title-first leads of mercari_leads_v and the default, and
// Verified, the photo-checked deal publication of mercari_published_deals_v.
// They are separate publications with separate rules, so each keeps its own
// view and its own API route; the switch only chooses which one renders. The
// choice is the leaf URL param ?feed=verified, with the default kept out.
export default function MercariTab({
  leadsLoader,
  leadsActor,
  dealsLoader,
  dealsActor,
}: {
  leadsLoader?: MercariLeadsLoader;
  leadsActor?: MercariLeadActor;
  dealsLoader?: MercariDealsLoader;
  dealsActor?: MercariDealActor;
}) {
  const { t } = useTranslation();
  const [feed, setFeed] = useState<MercariFeed>(readFeed);

  useEffect(() => {
    writeUrlParam(MERCARI_FEED_PARAM, feed === DEFAULT_MERCARI_FEED ? null : feed);
  }, [feed]);

  useEffect(() => {
    const onPop = () => setFeed(readFeed());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-4">
      <Tabs value={feed} onValueChange={(value) => setFeed(value as MercariFeed)}>
        <TabsList aria-label={t("mercari.feedLabel")}>
          <TabsTrigger className="min-h-11 px-4 sm:min-h-8" value="leads">{t("mercari.feedLeads")}</TabsTrigger>
          <TabsTrigger className="min-h-11 px-4 sm:min-h-8" value="verified">{t("mercari.feedVerified")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {feed === "leads" ? (
        <MercariLeadsView loader={leadsLoader} actor={leadsActor} />
      ) : (
        <MercariDealsView loader={dealsLoader} actor={dealsActor} />
      )}
    </div>
  );
}

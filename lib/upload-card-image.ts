// Shared helper for the Card Index create/edit modals to upload a user-picked
// image to Supabase Storage AFTER the RPC that created/edited the card has
// succeeded. Deferred-until-save so we never leak orphan objects from
// abandoned form dialogs.
//
// Layout matches the R2 side (tcg_tracker#388):
//   {game}/{uuid}/user_{ts}.{ext}
// - {game} is the storage prefix ('pokemon' | 'mtg' | 'pokemon_sealed')
// - {uuid} is the durable identifier (card_uid for pokemon, universal_uid
//   for mtg, product_uid for sealed). Looked up here from the row's int id
//   so the caller only needs to hand us (game, id).
// - {ts} is a millisecond-precision timestamp so re-uploads accumulate
//   instead of overwriting each other.
// - {ext} is derived from the file's MIME type ('jpg' | 'png' | 'webp').
//
// Sync-tcgplayer-images / sync-sealed-images still write to R2 at their own
// per-source slot ({game}/{uid}/tcgplayer.jpg, etc). User uploads land in
// Supabase Storage instead - both are surfaced as public URLs, both share
// the same UUID keying, so image_recognition can index both without needing
// to know which backend served the object.
import { createClient } from "@/lib/supabase/client";

export type UploadGame = "pokemon" | "mtg" | "pokemon_sealed";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Look up the durable UUID for a card/product given its bigint id.
async function resolveUid(game: UploadGame, id: number): Promise<string | null> {
  const supabase = createClient();
  if (game === "pokemon") {
    const { data } = await supabase
      .from("pokemon_card_definitions")
      .select("card_uid")
      .eq("card_id", id)
      .single();
    return (data?.card_uid as string | undefined) ?? null;
  }
  if (game === "mtg") {
    // Image lives on the universal (shared across variants).
    const { data } = await supabase
      .from("mtg_card_definitions_v")
      .select("card_uid, mtg_universal_id")
      .eq("card_id", id)
      .single();
    if (!data) return null;
    const univId = (data as { mtg_universal_id: number }).mtg_universal_id;
    const { data: uni } = await supabase
      .from("mtg_universal_cards")
      .select("universal_uid")
      .eq("universal_id", univId)
      .single();
    return (uni?.universal_uid as string | undefined) ?? null;
  }
  // pokemon_sealed
  const { data } = await supabase
    .from("pokemon_sealed_products")
    .select("product_uid")
    .eq("product_id", id)
    .single();
  return (data?.product_uid as string | undefined) ?? null;
}

export async function uploadCardImage(args: {
  game: UploadGame;
  id: number;
  file: File;
}): Promise<{ url: string } | { error: string }> {
  const ext = MIME_TO_EXT[args.file.type];
  if (!ext) return { error: `Unsupported image type: ${args.file.type}` };

  const uid = await resolveUid(args.game, args.id);
  if (!uid) return { error: "Could not resolve card UUID" };

  const ts = Date.now();
  const key = `${args.game}/${uid}/user_${ts}.${ext}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from("card-images").upload(key, args.file, {
    contentType: args.file.type,
    upsert: false,
  });
  if (error) return { error: error.message };

  const { data } = supabase.storage.from("card-images").getPublicUrl(key);
  return { url: data.publicUrl };
}

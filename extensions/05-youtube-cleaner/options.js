// Shared by content.js and the popup: every switch and its default.
const CLEAN_OPTIONS = {
  shorts:   { label: "Hide Shorts (and open Shorts links as normal videos)", def: true },
  home:     { label: "Hide the home page feed", def: false },
  related:  { label: "Hide recommended videos next to the player", def: false },
  endcards: { label: "Hide end-screen cards and video wall", def: true },
  comments: { label: "Hide comments", def: false },
  chat:     { label: "Hide live chat", def: false },
  mixes:    { label: "Hide Mixes / auto-generated playlists", def: false },
  news:     { label: "Hide news, \"Trending\" and \"Explore\" shelves", def: false },
};

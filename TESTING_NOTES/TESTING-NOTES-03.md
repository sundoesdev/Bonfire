# Testing Notes 03

## Bugs

- When finishing a study session, the sync happens in the background, but it looks like it just loads another deck in the meantime instead of exiting to the dashboard. This also happens when you try to exit a session early, something similar happens (while syncing, you're just presented with more hards instead of the "session ended" menu.)
- Syncing takes quite a wihle on program startup and study session ended, I wanna create loading menu during program setup so they're not just staring at a broken UI until the sync is done. As for the session ending, I won't really do anything there, the user will just have to wait till it syncs.
- Perhaps we can speed up the syncing? Why does it take so long? If theres not much we can do there, thats fine, just a brain storm for later
- When studying a single card from the library view (looking at all cards, and you click review on the far right), when you finish that single card, hit "complete" in the review page, it takes you back to the dashboard but the card is open for some on top of this UI as well. Similar to if you double click a card in the library view and it opens, imagine this hovering over the dashboard view when you return. Not a application breaking bug but it's annoying and unintended behavior.

## UI Changes

- to be announced 

## New Features / Changes 

- During program startup, Hearth should reach out to the source github (branch main), check for a pull, and update the software. There should then be a toast or small notif alerting the user that the software updated (and updated successfully or failed)

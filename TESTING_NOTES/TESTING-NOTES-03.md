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
- When I am going through a study session, sometimes I forgot why I got a card wrong and maybe 2 - 3 days in a row I get the same result cuz I failed to remember why I made the same error. I think a new feature Id like to implement to help with this is to add a "Notes" section, on the right-hand side of the "currently studying" window. So currently, when studying a card, you have the prompt and then the window you type the answer into. I'd like on the right hand side to be a small square text window, above it saying "Notes" that you can type into, and the next time this card comes up, the notes that you typed last time are there (which can also be edited). Put a small (and sublte) description somewhere near this as well that describes the intended purpoes of how to use these notes, aka "Write here why you failed this card last time, but obviously dont give yourself the answer". Actually instead of notes, let's call this "Hints". In the settings, under Cram Mode, add a toggle to turn hints on or not, and this will either keep the current UI (without the hints), or with the hints toggled, adds this text window going forward as you study. For example I might write someting like, "- you need & to access memory address" for a ptr card, and this will appear the next time I study that card.

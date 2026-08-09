# Testing Notes 03

## Bugs

- When finishing a study session, the sync happens in the background, but it looks like it just loads another deck in the meantime instead of exiting to the dashboard. This also happens when you try to exit a session early, something similar happens (while syncing, you're just presented with more hards instead of the "session ended" menu.)
- Syncing takes quite a wihle on program startup and study session ended, I wanna create loading menu during program setup so they're not just staring at a broken UI until the sync is done. As for the session ending, I won't really do anything there, the user will just have to wait till it syncs.
- Perhaps we can speed up the syncing? Why does it take so long? If theres not much we can do there, thats fine, just a brain storm for later

## UI Changes

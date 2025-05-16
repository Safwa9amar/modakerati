#!/bin/bash

cd ~/Desktop/modakerati || { echo "Folder not found"; exit 1; }

adb reverse tcp:4000 tcp:400 || { echo "adb reverse failed"; exit 1; }

# Open new terminal window for server
gnome-terminal --title="Server" -- bash -c "cd ~/Desktop/modakerati/server && npm run dev; exec bash" &

# Open new terminal window for client
gnome-terminal --title="Client" -- bash -c "cd ~/Desktop/modakerati/client && npm run dev; exec bash" &

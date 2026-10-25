Output "$DEMO_MP4"

Set FontFamily "DejaVu Sans Mono"
Set FontSize 30
Set Width 1920
Set Height 1080
Set Framerate 30
Set TypingSpeed 35ms
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set Padding 24
Set Margin 0
Set BorderRadius 0

Hide
Type "$DEMO_COMMAND"
Enter
Sleep 3s
Show
Wait+Screen /What do you want me to do/
Set TypingSpeed 80ms
Type "$DEMO_PROMPT"
Enter
Wait+Screen@60s /isolated workspace/
Sleep 3s
Hide
Type "/quit"
Enter
Sleep 1s

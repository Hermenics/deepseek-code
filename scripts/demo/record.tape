Output "$DEMO_MP4"

Set FontFamily "DejaVu Sans Mono"
Set FontSize 18
Set Columns 120
Set Rows 40
Set Framerate 30
Set TypingSpeed 35ms
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set Padding 24
Set Margin 24
Set MarginFill "#080a10"
Set BorderRadius 12

Hide
Type "$DEMO_COMMAND"
Enter
Sleep 3s
Show
Wait+Screen /What do you want me to do/
Set TypingSpeed 80ms
Type "$DEMO_PROMPT"
Enter
Wait+Screen@60s /full test suite passes/
Sleep 3s
Hide
Type "/quit"
Enter
Sleep 1s

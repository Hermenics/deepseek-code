# Constants — technical design

Constants are dependency-light TypeScript exports consumed by settings, agent, command, UI, and provider code. They encode defaults such as iteration/timeout/context/model/UI values, but are not a substitute for runtime validation. 🟢

## Dependencies

`src/constants/` feeds typed consumers; configuration validation keeps user input from assuming constant validity. 🟡

# Plugins — technical design

The manager validates a repository reference, shallow-clones it with a timeout, discovers a root or monorepo plugin manifest, validates safe naming, strips `.git`, moves the install atomically enough for recovery, and updates registry state. 🟢

| Interface | Contract |
| --- | --- |
| install/list/remove/update | Extension lifecycle operations |
| registry | Locally records installed extension metadata |
| manifest discovery | Recognizes supported root/monorepo layout |

The plugin directory defaults to a user location but can be overridden for testing/operation. 🟢

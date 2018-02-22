[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.me/niicodev)
[![Build Status](https://travis-ci.org/dracoapi/dracowalker.svg?branch=master)](https://travis-ci.org/dracoapi/dracowalker)
[![appveyor](https://ci.appveyor.com/api/projects/status/github/dracoapi/dracowalker?branch=master&svg=true)](https://ci.appveyor.com/project/niicojs/dracowalker/build/artifacts)


# DracoWalker

[![Greenkeeper badge](https://badges.greenkeeper.io/dracoapi/dracowalker.svg)](https://greenkeeper.io/)
Bot that play Draconius GO using my [DracoNode API](https://github.com/dracoapi/nodedracoapi).
It walks, spin and catch creatures. It can also clean inventory and hatch egg.  
Not meant to be a fully functional bot, it's more a proof of concept of what can be done with the API.

## Release

See https://github.com/dracoapi/dracowalker/releases.  
Dev build (unstable): https://ci.appveyor.com/project/niicojs/dracowalker/build/artifacts  


Create a `data/config.yaml` to [configure](https://github.com/dracoapi/dracowalker/wiki/config) it.



## Install from source & Run

Need up to date [node](https://nodejs.org) and [typescript](https://typescriptlang.org)

```
git clone https://github.com/dracoapi/dracowalker.git
cd dracowalker
npm i
tsc
node ./bin/app.js
```

Don't forget to create a `data/config.yaml` to [configure](https://github.com/dracoapi/dracowalker/wiki/config) it.



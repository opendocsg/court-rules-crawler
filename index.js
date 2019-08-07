const axios = require('axios')
const cheerio = require('cheerio')

const RULES_URL = 'https://sso.agc.gov.sg/SL/SCJA1969-R5'

function makeIndexPage (rawIndexPage) {
  const getText = (elements, selector) => elements.filter(selector).text().trim()
  const indexData = rawIndexPage.find('td')
  const provision = rawIndexPage.find('.empProvHd').text().trim()
  return `
# ${getText(indexData, '.SLRActHd')}

# ${provision}

# ${getText(indexData, '.slTitle')}


## ${getText(indexData, '.SLMNo')}

## ${getText(indexData, '.SLGNNo')}


### ${getText(indexData, '.revdHdr')}

### ${getText(indexData, '.revdTxt')}


${getText(indexData, '.cDate')}
`
}

function makeProvisionSection (provision) {
  if (provision.hasClass('prov1Hdr')) {
    return `## ${provision.text()}`
  } else if (!provision.children('a').length) {
    return provision.html()
  } else {
    return 'Structured Text'
  }
}

function makeOrderPage (order, $) {
  const orderTitle = order.find('.orderHdr').map(function () { return $(this).text() }).get().join(' - ')
  const provisions = order.find('div[class^=prov1] > table > tbody > tr > td')
    .map(function () { return makeProvisionSection($(this)) })
  return '' +
`# ${orderTitle}

${provisions.get().join('\n\n')}
`
}

async function go () {
  const { data: rules } = await axios(RULES_URL)
  const $ = cheerio.load(rules)
  const indexPage = makeIndexPage($('#legisContent .front'))
  const orders = $('#legisContent .body .order').map(function () { return makeOrderPage($(this), $) })
  console.log(orders[0])
}


go()

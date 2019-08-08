const axios = require('axios')
const cheerio = require('cheerio')

const TurndownService = require('turndown')
const turndownPluginGfm = require('turndown-plugin-gfm')
const turndown = new TurndownService({ headingStyle: 'atx' })
turndown.use(turndownPluginGfm.gfm)

turndown.keep(['sup', 'div'])

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

function makeStructuredProvision(provision, $, indent = 0) {
  const content = provision.contents().get()
    .filter(e => $(e).prop('tagName') !== 'A')
    .filter(e => $(e).prop('tagName') !== 'STRONG')
    .map(e => {
      let element = $(e)
      if (!element.prop('tagName')) {
        return element.text()
      }
      if (element.prop('tagName') === 'TABLE') {
        element = element.children('tbody').children('tr').children('td')
      }
      const subContent = element.contents().get()
        .map(c => {
          let child = $(c)
          if (!child.prop('tagName')) {
            return child.text()
          } else if (child.prop('tagName') === 'DIV' && child.hasClass('table-responsive')) {
            return child.children('table').children('tbody').children('tr').children('td').html()
          } else if (child.prop('tagName') === 'TABLE') {
            child = child.children('tbody').children('tr').children('td')
            return makeStructuredProvision(child, $, indent + 1)
          } else if (child.prop('tagName') === 'EM'){
            return `_${child.text()}_`
          } else {
            return child.get(0).outerHTML
          }
        })

      // TODO: Join content in smarter fashion
      return subContent.join('\n\n')
    })

  const prefix = indent === 0 && provision.children().first().prop('tagName') === 'STRONG'
    ? `**${provision.children('strong').html()}**` : ''
  return prefix + content.map(t => '>'.repeat(indent) + t).join('\n\n')
}

function makeProvision (provision, $) {
  if (provision.hasClass('prov1Hdr')) {
    return `## ${provision.text()}`
  } else if (!provision.children('a').length) {
    // Simple one-clause provision
    return turndown.turndown(provision.html())
  } else {
    return makeStructuredProvision(provision, $)
  }
}

function makeOrderPage (order, $) {
  const orderTitle = order.find('.orderHdr').map(function () { return $(this).text() }).get().join(' - ')
  const provisions = order.find('div[class^=prov1] > table > tbody > tr > td')
    .map(function () { return makeProvision($(this), $) })
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

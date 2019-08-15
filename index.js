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

function isText (element) {
  return element[0].type === 'text'
}

/**
 * Make a structured provision recursively
 * @param {*} provision
 * @param {*} $
 * @param {number} indent
 */
function makeStructuredProvision (provision, $, indent = 0) {
  const makeIndent = indent => '>'.repeat(Math.max(indent, 0))
  const markdown = element => turndown.turndown(element.clone().wrap('<span/>').parent().html())
  const content = provision.contents().get()
    .map(e => {
      const element = $(e)
      if (isText(element)) {
        return element.text()
      } else if (element.prop('tagName') === 'A') {
        const prevElement = element.prev()
        return prevElement.prop('tagName') === 'STRONG' ? '' : '\n\n' + makeIndent(indent)
      } else if (element.prop('tagName') === 'DIV' && element.hasClass('table-responsive')) {
        return '\n\n' + makeIndent(indent) + element.children('table').children('tbody').children('tr').children('td').html()
      } else if (element.prop('tagName') === 'DIV' && element.hasClass('amendNote')) {
        return '  \n' + makeIndent(indent) + markdown(element)
      } else if (element.prop('tagName') === 'TABLE') {
        const children = element.children('tbody').children('tr').children('td')
        const tableContent = children.length > 1
          ? makeIndent(indent + 1) + children.get()
            .map(child =>
              makeStructuredProvision($(child), $, indent + 1).trim().replace(new RegExp('^' + makeIndent(indent + 1) + '(.)'), '$1')
            )
            .join(' ')
          : makeStructuredProvision(children, $, indent + 1)
        return '\n\n' + tableContent
      } else if (element.prop('tagName') === 'SPAN') {
        return makeStructuredProvision(element, $, indent + 1).replace(new RegExp('^' + makeIndent(indent + 1) + '(.)'), '$1')
      } else {
        return markdown(element)
      }
    })

  return makeIndent(indent) + content.join('')
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

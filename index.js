const fs = require('fs')

const axios = require('axios')
const cheerio = require('cheerio')

const TurndownService = require('turndown')
const turndownPluginGfm = require('turndown-plugin-gfm')
const turndown = new TurndownService({ headingStyle: 'atx' })
turndown.use(turndownPluginGfm.gfm)

turndown.keep(['sup', 'div'])

const RULES_URL = 'https://sso.agc.gov.sg/SL/SCJA1969-R5'
const RULES_DIR = 'opendoc-rules-of-court'

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
        return prevElement.length === 0 || prevElement.prop('tagName') === 'STRONG' ? '' : '\n\n' + makeIndent(indent)
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
  if (provision.hasClass('prov1Hdr') || provision.hasClass('partHdrIta') || provision.hasClass('partHdrNorm')) {
    return `## ${provision.text()}`
  } else if (provision.hasClass('sProvHdr') || provision.hasClass('sGrpHdrCaps')) {
    provision.find('br').replaceWith(' ')
    return `### ${provision.text()}`
  } else if (!provision.children('a').length) {
    // Simple one-clause provision
    return turndown.turndown(provision.html())
  } else {
    return makeStructuredProvision(provision, $)
  }
}

function makeOrderPage (order, $) {
  const title = order.find('.orderHdr')
    .map(function () {
      return $(this).html()
    })
    .get()
    .join(' - ')
    .trim()

  const provisions = order
    .children()
    .not((i, e) => $(e).children('tbody').children('tr').children('td').hasClass('appendix'))
    .find('td.sGrpTail > table > tbody > tr > td, div[class^=prov1] > table > tbody > tr > td')
    .get()
    .map(e => makeProvision($(e), $))
  if (provisions.length === 0) {
    provisions.push(turndown.turndown(order.find('.orderRepealed').html()))
  }
  const content = '' +
`# ${title}

${provisions.join('\n\n')}
`
  return { content, title: title.replace(/<sup>\d+<\/sup>/g, '') }
}

function makeOrderAppendix(appendix, $) {
  const ref = appendix.find('.SbodyRefs').text()
  const title = appendix.find('td[class^=appendixHdr]')
    .map(function () {
      return $(this).text()
    })
    .get()
    .join(' - ')
    .replace(ref, '')
    .trim()

  const provisions = appendix
    .find('.sProvHdr, td.sGrpTail > table > tbody > tr > td, td.tailSTxt, td.sGrpTail > div.table-responsive')
    .get()
    .map(e => {
      const element = $(e)
      return element.hasClass('table-responsive')
        ? element.clone().wrap('<span/>').parent()
        : e
    })
    .map(e => makeProvision($(e), $))

  const content = '' +
`## ${title}

<div class="orderRef">${ref}</div>

${provisions.join('\n\n')}

`
  return content
}

function makeOrder ($, index) {
  const [ order ] = $('.order').get().map(e => makeOrderPage($(e), $))
  if (order) {
    let { content, title } = order

    const appendices = $('.order .appendix').get()
    if (appendices.length > 0) {
      content += '\n\n' + appendices.map(e => makeOrderAppendix($(e), $)).join('\n\n')
    }

    const path = `../${RULES_DIR}/${index}-${title}.md`
    console.log(`Writing to ${path}`)
    fs.writeFileSync(path, content)
  }
}

async function go () {
  console.log(`Fetching index page from ${RULES_URL}`)
  const { data: rules } = await axios(RULES_URL)
  const $ = cheerio.load(rules)
  const indexPage = makeIndexPage($('#legisContent .front'))
  const indexPath = `../${RULES_DIR}/index.md`
  console.log(`Writing to ${indexPath}`)
  fs.writeFileSync(indexPath, indexPage)

  // The index page contains the first order, so scrape it from there
  makeOrder($, 1)

  const seriesIds = $('.dms[data-field=seriesId]').map((i, e) => $(e).attr('data-term')).get()
  const [ { tocSysId, fragments } ] = $('.global-vars').last()
    .map((i, e) => JSON.parse($(e).attr('data-json')))
    .get()

  let index = 2
  for (const seriesId of seriesIds) {
    const { Item1: fragSysId, Item2: dateString } = fragments[seriesId]
    const url = `https://sso.agc.gov.sg/Details/GetLazyLoadContent?TocSysId=${tocSysId}&SeriesId=${seriesId}&FragSysId=${fragSysId}&_=${dateString}`
    console.log(`Fetching ${url}`)
    const { data: orderPage } = await axios(url)
    const $ = cheerio.load(orderPage)
    makeOrder($, index)
    ++index
  }
}


go()

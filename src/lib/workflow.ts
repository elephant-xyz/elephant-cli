import { Workflow } from './withBrowserFlow.js';

export const workflow: Workflow = {
  starts_at: 'open_search_page',
  states: {
    open_search_page: {
      type: 'open_page',
      next: 'wait_for_button',
      input: {
        url: 'https://qpublic.schneidercorp.com/Application.aspx?AppID=1081&LayerID=26490&PageTypeID=2&PageID=10768',
        timeout: 30000,
        wait_until: 'networkidle2',
      },
    },
    wait_for_button: {
      type: 'wait_for_selector',
      input: {
        selector: '.btn.btn-primary.button-1',
        timeout: 8000,
        visible: true,
      },
      next: 'click_continue_button',
      result: 'continue_button',
    },
    click_continue_button: {
      type: 'click',
      input: {
        selector: '{{=it.continue_button}}',
      },
      next: 'enter_parcel_id',
    },
    enter_parcel_id: {
      type: 'type',
      input: {
        selector: '#ctlBodyPane_ctl03_ctl01_txtParcelID',
        value: '{{=it.request_identifier}}',
        delay: 100,
      },
      next: 'press_enter',
    },
    press_enter: {
      type: 'keyboard_press',
      input: {
        key: 'Enter',
      },
      next: 'wait_for_search_results',
    },
    wait_for_search_results: {
      type: 'wait_for_selector',
      end: true,
      input: {
        selector:
          '#ctlBodyPane_ctl10_ctl01_lstBuildings_ctl00_dynamicBuildingDataRightColumn_divSummary',
        timeout: 15000,
        visible: true,
      },
    },
  },
};

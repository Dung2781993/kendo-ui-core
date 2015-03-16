package com.kendoui.spring.controllers.responsivepanel;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

@Controller("responsivepanel-home-controller")
@RequestMapping(value="/responsivepanel/")
public class IndexController {
    
    @RequestMapping(value = {"/", "/index"}, method = RequestMethod.GET)
    public String index() {
        return "responsivepanel/index";
    }    
}